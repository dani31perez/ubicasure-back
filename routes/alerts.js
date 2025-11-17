const express = require("express");
const router = express.Router();
const { sql, poolPromise } = require("../dbConfig"); // Asegúrate que la ruta sea correcta

async function deleteOldAlerts() {
  try {
    const pool = await poolPromise;
    const query = `
      DECLARE @nowGuatemala DATETIME = DATEADD(hour, -6, GETUTCDATE());
      DECLARE @unaHoraAtras DATETIME = DATEADD(hour, -1, @nowGuatemala);
      DELETE FROM Alerts
      WHERE fechaCreacion < @unaHoraAtras;
    `;
    await pool.request().query(query);
  } catch (error) {
    console.error("Error al borrar alertas en SQL Server:", error);
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
    const pool = await poolPromise;
    const query = `
      INSERT INTO Alerts (email, latitude, longitude)
      OUTPUT INSERTED.alertId
      VALUES (@email, @lat, @lon);
    `;

    const result = await pool
      .request()
      .input("email", sql.NVarChar, email)
      .input("lat", sql.Float, latitude)
      .input("lon", sql.Float, longitude)
      .query(query);

    res.status(201).json({
      message: "Alerta creada exitosamente.",
      alertId: result.recordset[0].alertId,
    });
  } catch (error) {
    console.error("Error al crear alerta en SQL Server:", error);
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

    const pool = await poolPromise;

    const query = `
      DECLARE @userLat FLOAT = @lat;
      DECLARE @userLon FLOAT = @lon;
      DECLARE @radiusKm FLOAT = @radius;
      DECLARE @R FLOAT = 6371; -- Radio de la Tierra en km

      ;WITH AlertsWithDistance AS (
          SELECT
              email,
              latitude,
              longitude,
              (@R * 2 * ATN2(
                  SQRT(
                      SIN(RADIANS(latitude - @userLat) / 2) * SIN(RADIANS(latitude - @userLat) / 2) +
                      COS(RADIANS(@userLat)) * COS(RADIANS(latitude)) *
                      SIN(RADIANS(longitude - @userLon) / 2) * SIN(RADIANS(longitude - @userLon) / 2)
                  ),
                  SQRT(1 - (
                      SIN(RADIANS(latitude - @userLat) / 2) * SIN(RADIANS(latitude - @userLat) / 2) +
                      COS(RADIANS(@userLat)) * COS(RADIANS(latitude)) *
                      SIN(RADIANS(longitude - @userLon) / 2) * SIN(RADIANS(longitude - @userLon) / 2)
                  ))
              )) AS distanceInKm
          FROM Alerts
      )
      SELECT email, latitude, longitude, distanceInKm
      FROM AlertsWithDistance
      WHERE distanceInKm <= @radiusKm
      ORDER BY distanceInKm;
    `;

    const result = await pool
      .request()
      .input("lat", sql.Float, userLat)
      .input("lon", sql.Float, userLon)
      .input("radius", sql.Float, searchRadiusKm)
      .query(query);

    res.status(200).json(result.recordset);
  } catch (error) {
    console.error("Error al buscar alertas cercanas:", error);
    res
      .status(500)
      .json({ error: "Error interno del servidor.", details: error.message });
  }
});

module.exports = router;
