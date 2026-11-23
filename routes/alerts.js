const express = require("express");
const router = express.Router();
const { poolPromise } = require("../config/dbConfig.js"); 
const authenticateUser = require("../middleware/authenticateUser");
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });
const { addFiles, detectIncident, sendPushNotifications } = require("../utils/utils.js");
const { fetchNearbyPlaces } = require("../utils/places");
const {authenticateMember} = require("../middleware/jwt");
const { sendSmsNotifications } = require("../config/textBee.js");
const { sendTelegramNotification } = require("../config/telegram.js");
const attendingNames = `(
  SELECT JSON_ARRAYAGG(s.name) FROM AlertAttendingStations ats
  JOIN Stations s ON s.stationId = ats.stationId
  WHERE ats.alertId = a.alertId
)`;
const { createAlertStream } = require("../utils/alertStream.js");
const { getFirestore } = require("firebase-admin/firestore");
const { getIncidentTips } = require("../utils/incidentTips.js");
const { createAlertTrackingRouter } = require("./alertTracking.js");

const trackingRoutes = createAlertTrackingRouter({ poolPromise, authenticateMember, authenticateUser });
router.use("/tracking", trackingRoutes);

function parseArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

// Public dashboard data deliberately excludes the reporter's email.
async function loadDashboardAlerts() {
  const pool = await poolPromise;
  const [rows] = await pool.execute(`
    SELECT alertId, latitude, longitude, reliability, images, analysis,
           fechaCreacion, ${attendingNames} AS attendingStations
    FROM Alerts a
    WHERE active = 1
      AND fechaCreacion >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR)
    ORDER BY alertId;
  `);
  return rows.map(row => ({
    alertId: String(row.alertId),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    reliability: row.reliability == null ? null : Number(row.reliability),
    images: parseArray(row.images),
    analysis: parseArray(row.analysis),
    attendingStations: parseArray(row.attendingStations),
    fechaCreacion: row.fechaCreacion instanceof Date ? row.fechaCreacion.toISOString() : row.fechaCreacion,
  }));
}

const alertStream = createAlertStream({ loadActiveAlerts: loadDashboardAlerts });
router.attachWebSocketServer = server => {
  alertStream.attach(server);
  trackingRoutes.attachWebSocketServer(server);
};
router.closeRealtime = () => {
  trackingRoutes.closeRealtime();
  alertStream.close();
};

router.get("/stream", (req, res) => {
  res.set("Upgrade", "websocket").status(426).json({
    error: "Este endpoint requiere una conexión WebSocket.",
  });
});

function toRad(value) {
  return (value * Math.PI) / 180;
}

async function getNearbyStationMembers(latitude, longitude) {
  const location = `${latitude},${longitude}`;
  const radiusMeters = 1000;
  const results = await Promise.all(["police", "fire_station"].map(type =>
    fetchNearbyPlaces(type, location, radiusMeters, process.env.GOOGLE_MAPS_API_KEY)
  ));
  const placeIds = new Set();
  for (const place of results.flat()) {
    const point = place.geometry?.location;
    if (place.place_id && Number.isFinite(point?.lat) && Number.isFinite(point.lng) &&
        haversineDistanceMeters(latitude, longitude, point.lat, point.lng) <= radiusMeters) {
      placeIds.add(place.place_id);
    }
  }
  if (!placeIds.size) return [];
  const pool = await poolPromise;
  const [members] = await pool.execute(`
    SELECT m.email, m.phone, m.fcmToken, m.telegramChatId
    FROM Stations s JOIN Members m ON m.stationId = s.stationId
    WHERE s.googlePlaceId IN (${Array.from(placeIds, () => "?").join(", ")})
  `, [...placeIds]);
  return members;
}

async function getNearbyAlerts(latitude, longitude, radiusKm, stationId) {
  const coverageColumn = stationId === undefined ? "" : `
      EXISTS (
        SELECT 1 FROM Stations s WHERE s.stationId = ?
        AND ST_Intersects(s.coverage,
          ST_PointFromText(CONCAT('POINT(', a.longitude, ' ', a.latitude, ')'), 4326, 'axis-order=long-lat'))
      ) AS withinCoverage,`;
  const query = `
    SELECT
      alertId,
      latitude,
      longitude,
      reliability,
      email,
      images,
      analysis,
      ${coverageColumn}
      ST_Distance_Sphere(
        POINT(longitude, latitude),
        POINT(?, ?)
      ) / 1000 AS distanceInKm
    FROM Alerts a
    WHERE active = 1
    HAVING distanceInKm <= ?
    ORDER BY distanceInKm;
  `;

  const pool = await poolPromise;

  const [rows] = await pool.execute(query, [
    ...(stationId === undefined ? [] : [stationId]),
    longitude,
    latitude,
    radiusKm,
  ]);

  return rows.map((row) => ({
    ...row,
    ...(stationId === undefined ? {} : { withinCoverage: Number(row.withinCoverage) === 1 }),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    reliability: Number(row.reliability),
    distanceInKm: Number(row.distanceInKm),
  }));
}

function getAlertLevel(hasNearbyAlert, hasIncident) {
  if (hasNearbyAlert && hasIncident) {
    return 3;
  }

  if (hasIncident) {
    return 2;
  }

  if (hasNearbyAlert) {
    return 1;
  }

  return 0;
}

async function sendAlertNotifications(level, members, alertData) {
  if (level === 0) {
    return;
  }

  if (level === 1) {
    return sendPushNotifications(members, alertData);
  }

  if (level === 2) {
    return sendTelegramNotification(members, alertData);
  }

  if (level === 3) {
    return sendSmsNotifications(members, alertData);
  }
}

function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function clusterAlerts(alerts, radiusMeters) {
  const used = new Array(alerts.length).fill(false);
  const clusters = [];

  for (let i = 0; i < alerts.length; i++) {
    if (used[i]) continue;
    const group = [alerts[i]];
    used[i] = true;

    for (let j = i + 1; j < alerts.length; j++) {
      if (used[j]) continue;
      const distance = haversineDistanceMeters(
        alerts[i].latitude,
        alerts[i].longitude,
        alerts[j].latitude,
        alerts[j].longitude
      );
      if (distance <= radiusMeters) {
        group.push(alerts[j]);
        used[j] = true;
      }
    }

    clusters.push(group);
  }

  return clusters.map((group) => (group.length === 1 ? group[0] : group));
}

async function deactivateOldAlerts() {
  try {
    const query = `
      UPDATE Alerts
      SET active = 0
      WHERE active = 1
        AND fechaCreacion < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR);
    `;
    const pool = await poolPromise;
    const [result] = await pool.execute(query);
    if (result.affectedRows > 0) await alertStream.refresh();
  } catch (error) {
    console.error("Error al desactivar alertas en MySQL:", error);
    throw new Error(
      `Error en el proceso de desactivación de alertas: ${error.message}`
    );
  }
}

router.post("/", authenticateUser, upload.array("images"), async (req, res) => {
  const { latitude, longitude } = req.body;
  const email = req.user.email;
  if (!email || latitude == null || longitude == null ||
      String(latitude).trim() === "" || String(longitude).trim() === "") {
    return res
      .status(400)
      .json({ error: "Faltan los campos email, latitude o longitude." });
  }

  try {
    const userLat = Number(latitude);
    const userLon = Number(longitude);
    if (!Number.isFinite(userLat) || !Number.isFinite(userLon) ||
        userLat < -90 || userLat > 90 || userLon < -180 || userLon > 180) {
      return res.status(400).json({ error: "Latitud o longitud inválida." });
    }
    const pool = await poolPromise;

    const [userResult] = await pool.execute(
      "SELECT reliability FROM Users WHERE email = ?",
      [email]
    );

    if (userResult.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado." });
    }

    const reliability = userResult[0].reliability;

    let imageUrls = [];
    if (req.files && req.files.length > 0) {
      imageUrls = await addFiles(req.files, "alert_images", email);
    }

    const query = `
      INSERT INTO Alerts (email, latitude, longitude, reliability, images)
      VALUES (?, ?, ?, ?, ?);
    `;
    const [result] = await pool.execute(query, [
      email,
      latitude,
      longitude,
      reliability,
      JSON.stringify(imageUrls),
    ]);

    const alertId = result.insertId;
    await alertStream.refresh();

    res.status(201).json({
      message: "Alerta registrada exitosamente.",
      alertId,
      images: imageUrls,
      analysisRequired: imageUrls.length > 0,
    });
  } catch (error) {
    console.error("Error al crear alerta en MySQL:", error);
    res
      .status(500)
      .json({ error: "Error interno del servidor.", details: error.message });
  }
});

router.post("/:alertId/analyze", authenticateUser, async (req, res) => {
  const { alertId } = req.params;
  const email = req.user.email;

  if (!email) return res.status(403).json({ error: "La cuenta debe tener un correo asociado." });
  if (!/^[1-9]\d*$/.test(alertId)) {
    return res.status(400).json({ error: "El identificador de alerta no es válido." });
  }
  try {
    const pool = await poolPromise;
    await deactivateOldAlerts();
    const [rows] = await pool.execute(
      "SELECT alertId, email, latitude, longitude, images, analysis, active FROM Alerts WHERE alertId = ? AND email = ?",
      [alertId, email]
    );
    if (!rows.length) return res.status(404).json({ error: "Alerta no encontrada." });
    const alert = rows[0];
    if (!alert.active) return res.status(409).json({ error: "La alerta está desactivada." });
    const images = parseArray(alert.images);
    if (!images.length || images.some(url => typeof url !== "string" || !url)) {
      return res.status(400).json({ error: "La alerta no tiene imágenes para analizar." });
    }

    const errors = [];
    const analysis = await Promise.all(images.map(async (url, imageIndex) => {
      try {
        const result = await detectIncident(url);
        if (result?.success !== true || typeof result.incident_detected !== "boolean") {
          throw new Error("Respuesta de análisis inválida.");
        }
        return result;
      } catch {
        errors.push({ imageIndex, error: "No fue posible analizar esta imagen." });
        return null;
      }
    }));

    await pool.execute("UPDATE Alerts SET analysis = ? WHERE alertId = ?", [
      JSON.stringify(analysis), alert.alertId,
    ]);
    await alertStream.refresh();

    const nearby = await getNearbyAlerts(Number(alert.latitude), Number(alert.longitude), 5);
    const hasNearbyAlert = nearby.some(other => String(other.alertId) !== String(alert.alertId));
    const hasIncident = analysis.some(result => result?.incident_detected === true);
    const level = getAlertLevel(hasNearbyAlert, hasIncident);
    let notification = { status: "not_required", level };
    if (level > 0) {
      try {
        const members = await getNearbyStationMembers(alert.latitude, alert.longitude);
        if (members.length) {
          const attempts = await sendAlertNotifications(level, members, {
            alertId: alert.alertId, email: alert.email,
            latitude: Number(alert.latitude), longitude: Number(alert.longitude), analysis,
          });
          const failed = Array.isArray(attempts) && attempts.some(attempt => attempt.status === "rejected");
          notification = { status: failed ? "unconfirmed" : "requested", level };
        } else {
          notification = { status: "no_recipients", level };
        }
      } catch {
        notification = { status: "unconfirmed", level };
      }
    }

    let tips = [];
    let tipsStatus = "available";
    try { tips = await getIncidentTips(getFirestore(), analysis); }
    catch { tipsStatus = "unavailable"; }

    const allFailed = analysis.every(result => result === null);
    res.status(allFailed ? 502 : 200).json({
      alertId: alert.alertId,
      analysis,
      errors: errors.sort((a, b) => a.imageIndex - b.imageIndex),
      tips, tipsStatus, notification,
    });
  } catch {
    res.status(500).json({ error: "No fue posible completar el análisis de la alerta." });
  }
});

router.get("/", (req, res, next) => {
  if (req.query.stationId === undefined) return next();
  return authenticateMember(req, res, next);
}, async (req, res) => {
  const { lat, lon } = req.query;
  const searchRadiusKm = 5;
  if (!lat || !lon) {
    return res
      .status(400)
      .json({ error: "Faltan los parámetros de consulta lat y lon." });
  }
  const userLat = parseFloat(lat);
  const userLon = parseFloat(lon);

  try {
    await deactivateOldAlerts();
    const nearbyAlerts = await getNearbyAlerts(userLat, userLon, searchRadiusKm, req.member?.stationId);
    const clustered = clusterAlerts(nearbyAlerts, 5); // Agrupar marcadores a 5 metros.

    res.status(200).json(clustered);
  } catch (error) {
    console.error("Error al buscar alertas cercanas:", error);
    res
      .status(500)
      .json({ error: "Error interno del servidor.", details: error.message });
  }
});

router.put("/attend/:alertId", authenticateMember, async (req, res) => {
  const { alertId } = req.params;
  const { stationId } = req.member;

  try {
    const pool = await poolPromise;
    await pool.execute(`
      INSERT INTO AlertAttendingStations (alertId, stationId)
      SELECT a.alertId, ? FROM Alerts a WHERE a.alertId = ?
      ON DUPLICATE KEY UPDATE startedAt = AlertAttendingStations.startedAt
    `, [stationId, alertId]);
    const [rows] = await pool.execute(`
      SELECT ${attendingNames} AS attendingStations FROM Alerts a WHERE a.alertId = ?
    `, [alertId]);
    if (!rows.length) return res.status(404).json({ error: "Alerta no encontrada." });
    await alertStream.refresh();
    res.status(200).json({ message: "Estación agregada.", attendingStations: parseArray(rows[0].attendingStations) });
  } catch (error) {
    res.status(500).json({ error: error.message, details: error.message });
  }
});

router.get("/getbyStation/:stationId", authenticateMember, async (req, res) => {
  const { stationId } = req.member;

  try {
    const pool = await poolPromise;
    const query = `
      SELECT a.alertId, a.latitude, a.longitude, a.reliability, a.email,
             ${attendingNames} AS attendingStations, a.images, a.fechaCreacion
      FROM AlertAttendingStations ats JOIN Alerts a ON a.alertId = ats.alertId
      WHERE a.active = 1 AND ats.stationId = ?
      ORDER BY a.fechaCreacion DESC;
    `;
    const [rows] = await pool.execute(query, [stationId]);

    res.status(200).json(rows);
  } catch (error) {
    console.error("Error al buscar alertas por estación:", error);
    res
      .status(500)
      .json({ error: "Error interno del servidor.", details: error.message });
  }
});

// Logical deletion preserves the record and removes its marker on every dashboard.
router.delete("/:alertId", authenticateMember, async (req, res) => {
  const { alertId } = req.params;
  if (!/^\d+$/.test(alertId)) {
    return res.status(400).json({ error: "El identificador de alerta no es válido." });
  }
  try {
    const pool = await poolPromise;
    const [rows] = await pool.execute("SELECT alertId FROM Alerts WHERE alertId = ?", [alertId]);
    if (!rows.length) return res.status(404).json({ error: "Alerta no encontrada." });
    await pool.execute("UPDATE Alerts SET active = 0 WHERE alertId = ?", [alertId]);
    trackingRoutes.stopAlert(alertId);
    await alertStream.refresh();
    res.status(200).json({ message: "Alerta desactivada exitosamente.", alertId, active: false });
  } catch (error) {
    console.error("Error al desactivar alerta en MySQL:", error);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

module.exports = router;
