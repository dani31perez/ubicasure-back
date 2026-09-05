const express = require("express");
const router = express.Router();
const { poolPromise } = require("../dbConfig"); 
const authenticateUser = require("../middleware/authenticateUser");
const ALERT_CLUSTER_RADIUS_METERS = 100;

async function deleteOldAlerts() {
  try {
    const query = `
      DELETE FROM Alerts
      WHERE fechaCreacion < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR);
    `;
    const pool = await poolPromise;
    await pool.execute(query);
  } catch (error) {
    console.error("Error al borrar alertas en MySQL:", error);
    throw new Error(
      `Error en el proceso de borrado de alertas: ${error.message}`
    );
  }
}

router.post("/", authenticateUser,  async (req, res) => {
  const { latitude, longitude } = req.body;
  const email = req.user.email;

  await deleteOldAlerts();
  if (!email || !latitude || !longitude) {
    return res
      .status(400)
      .json({ error: "Faltan los campos email, latitude o longitude." });
  }

  try {
    const pool = await poolPromise;

    const nearbyQuery = `
      SELECT alertId
      FROM Alerts
      WHERE ST_Distance_Sphere(POINT(longitude, latitude), POINT(?, ?)) <= ?
      ORDER BY ST_Distance_Sphere(POINT(longitude, latitude), POINT(?, ?)) ASC
      LIMIT 1;
    `;
    const [nearby] = await pool.execute(nearbyQuery, [
      longitude,
      latitude,
      ALERT_CLUSTER_RADIUS_METERS,
      longitude,
      latitude,
    ]);

    if (nearby.length > 0) {
      const updateQuery = `
        UPDATE Alerts
        SET cantidad = cantidad + 1, fechaCreacion = UTC_TIMESTAMP()
        WHERE alertId = ?;
      `;
      await pool.execute(updateQuery, [nearby[0].alertId]);

      return res.status(200).json({
        message: "Alerta cercana actualizada exitosamente.",
        alertId: nearby[0].alertId,
      });
    }

    const query = `
      INSERT INTO Alerts (email, latitude, longitude, cantidad)
      VALUES (?, ?, ?, 1);
    `;

    const [result] = await pool.execute(query, [email, latitude, longitude]);

    res.status(201).json({
      message: "Alerta creada exitosamente.",
      alertId: result.insertId,
    });
  } catch (error) {
    console.error("Error al crear alerta en MySQL Server:", error);
    res
      .status(500)
      .json({ error: "Error interno del servidor.", details: error.message });
  }
});

router.get("/", async (req, res) => {
  const { lat, lon } = req.query;
  const searchRadiusKm = 5;
  await deleteOldAlerts();
  if (!lat || !lon) {
    return res
      .status(400)
      .json({ error: "Faltan los parámetros de consulta lat y lon." });
  }

  try {
    const userLat = parseFloat(lat);
    const userLon = parseFloat(lon);

    const query = `
          SELECT email, latitude, longitude, cantidad,
            ST_Distance_Sphere(POINT(longitude, latitude), POINT(?, ?)) / 1000 AS distanceInKm
          FROM Alerts
          HAVING distanceInKm <= ?
          ORDER BY distanceInKm;
        `;

    const pool = await poolPromise;
    const [result] = await pool.execute(query, [userLon, userLat, searchRadiusKm]);

    res.status(200).json(result);
  } catch (error) {
    console.error("Error al buscar alertas cercanas:", error);
    res
      .status(500)
      .json({ error: "Error interno del servidor.", details: error.message });
  }
});

module.exports = router;