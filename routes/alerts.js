const express = require("express");
const router = express.Router();
const { poolPromise } = require("../dbConfig"); 
const authenticateUser = require("../middleware/authenticateUser");
const ALERT_CLUSTER_RADIUS_METERS = 100;

function toRad(value) {
  return (value * Math.PI) / 180;
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
    await pool.execute(query);
  } catch (error) {
    console.error("Error al desactivar alertas en MySQL:", error);
    throw new Error(
      `Error en el proceso de desactivación de alertas: ${error.message}`
    );
  }
}

router.post("/", authenticateUser, async (req, res) => {
  const { latitude, longitude } = req.body;
  const email = req.user.email;
  await deactivateOldAlerts();
  if (!email || !latitude || !longitude) {
    return res
      .status(400)
      .json({ error: "Faltan los campos email, latitude o longitude." });
  }

  try {
    const pool = await poolPromise;

    const [userResult] = await pool.execute(
      "SELECT reliability FROM Users WHERE email = ?",
      [email]
    );

    if (userResult.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado." });
    }

    const reliability = userResult[0].reliability;

    const query = `
      INSERT INTO Alerts (email, latitude, longitude, reliability)
      VALUES (?, ?, ?, ?);
    `;
    const [result] = await pool.execute(query, [email, latitude, longitude, reliability]);

    res.status(201).json({
      message: "Alerta registrada exitosamente.",
      alertId: result.insertId,
    });
  } catch (error) {
    console.error("Error al crear alerta en MySQL:", error);
    res
      .status(500)
      .json({ error: "Error interno del servidor.", details: error.message });
  }
});

router.get("/", async (req, res) => {
  const { lat, lon } = req.query;
  const searchRadiusKm = 5;
  await deactivateOldAlerts();
  if (!lat || !lon) {
    return res
      .status(400)
      .json({ error: "Faltan los parámetros de consulta lat y lon." });
  }

  try {
    const userLat = parseFloat(lat);
    const userLon = parseFloat(lon);

    const query = `
      SELECT latitude, longitude, reliability,
        ST_Distance_Sphere(POINT(longitude, latitude), POINT(?, ?)) / 1000 AS distanceInKm
      FROM Alerts
      WHERE active = 1
      HAVING distanceInKm <= ?
      ORDER BY distanceInKm;
    `;

    const pool = await poolPromise;
    const [rows] = await pool.execute(query, [userLon, userLat, searchRadiusKm]);

    const normalizedRows = rows.map((row) => ({
      ...row,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      reliability: Number(row.reliability),
    }));

    const clustered = clusterAlerts(normalizedRows, ALERT_CLUSTER_RADIUS_METERS);

    res.status(200).json(clustered);
  } catch (error) {
    console.error("Error al buscar alertas cercanas:", error);
    res
      .status(500)
      .json({ error: "Error interno del servidor.", details: error.message });
  }
});

module.exports = router;