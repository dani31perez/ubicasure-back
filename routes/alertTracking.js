const express = require("express");
const { createAlertTracking, TrackingError } = require("../utils/alertTracking");

function positiveEnv(name, fallback, min, max) {
  if (process.env[name] == null) return fallback;
  const value = Number(process.env[name]);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} debe ser un entero entre ${min} y ${max}.`);
  }
  return value;
}

function createAlertTrackingRouter({ poolPromise, authenticateMember, authenticateUser, options = {} }) {
  const router = express.Router();
  const tracking = createAlertTracking({
    authenticateMember,
    authenticateUser,
    async loadAlerts(alertIds) {
      if (!alertIds.length) return [];
      const pool = await poolPromise;
      // Read only. Use the existing one-hour lifetime and attendance fields.
      const [rows] = await pool.execute(`
        SELECT alertId, email, attendingStations,
          (active = 1 AND fechaCreacion >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR)) AS trackingEligible
        FROM Alerts
        WHERE alertId IN (${alertIds.map(() => "?").join(",")})
      `, alertIds);
      return rows;
    },
    async loadMember(email) {
      const pool = await poolPromise;
      const [rows] = await pool.execute(
        "SELECT email, fullName, station FROM Members WHERE email = ?", [email]
      );
      return rows[0] ?? null;
    },
    locationTimeoutMs: positiveEnv("TRACKING_LOCATION_TIMEOUT_MS", 20000, 15000, 300000),
    maxStreams: positiveEnv("TRACKING_MAX_STREAMS", 200, 1, 10000),
    maxConnections: positiveEnv("TRACKING_MAX_CONNECTIONS", 500, 1, 10000),
    ...options,
  });

  const respond = handler => async (req, res) => {
    res.set("Cache-Control", "no-store");
    try { await handler(req, res); }
    catch (error) {
      if (!(error instanceof TrackingError)) console.error("Error en seguimiento de alerta:", error.message);
      res.status(error instanceof TrackingError ? error.status : 503).json({
        code: error instanceof TrackingError ? error.code : "tracking_unavailable",
        error: error instanceof TrackingError ? error.message : "No fue posible consultar el seguimiento.",
      });
    }
  };

  // User email and member identity always come from the verified token.
  router.get("/active", authenticateUser, respond(async (req, res) => {
    const trackings = await tracking.listForUser(req.user);
    res.json({ trackings, serverTime: new Date().toISOString() });
  }));

  router.get("/mine", authenticateMember, respond(async (req, res) => {
    const trackings = await tracking.listForMember(req.member);
    res.json({ trackings, serverTime: new Date().toISOString() });
  }));

  router.delete("/:trackingId", authenticateMember, respond(async (req, res) => {
    tracking.stop(req.params.trackingId, req.member);
    res.json({ message: "Transmisión de ubicación finalizada.", trackingId: req.params.trackingId });
  }));

  for (const path of ["/publish", "/watch"]) {
    router.get(path, (req, res) => {
      res.set("Upgrade", "websocket").status(426).json({ error: "Este endpoint requiere una conexión WebSocket." });
    });
  }

  router.attachWebSocketServer = server => tracking.attach(server);
  router.stopAlert = alertId => tracking.stopAlert(alertId);
  router.reconcile = () => tracking.reconcile();
  router.closeRealtime = () => tracking.close();
  return router;
}

module.exports = { createAlertTrackingRouter };
