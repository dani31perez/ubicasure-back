const express = require("express");
const router = express.Router();
const { poolPromise } = require("../dbConfig"); // Asegúrate que la ruta sea correcta

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

router.post("/", async (req, res) => {
  const { email, latitude, longitude } = req.body;
  await deleteOldAlerts();
  if (!email || !latitude || !longitude) {
    return res
      .status(400)
      .json({ error: "Faltan los campos email, latitude o longitude." });
  }

  try {
     const query = `
      INSERT INTO Alerts (email, latitude, longitude)
      VALUES (?, ?, ?);
    `;

    const pool = await poolPromise;
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
          SELECT email, latitude, longitude,
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
