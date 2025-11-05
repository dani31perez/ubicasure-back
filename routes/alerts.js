const express = require("express");
const router = express.Router();
const { sql, poolPromise } = require("../dbConfig"); // Asegúrate que la ruta sea correcta

router.post("/", async (req, res) => {
  const { uid, latitude, longitude } = req.body;

  if (!uid || !latitude || !longitude ) {
    return res
      .status(400)
      .json({ error: "Faltan los campos uid, latitude, o longitude." });
  }

  try {
    const pool = await poolPromise;
    const query = `
      INSERT INTO Alerts (firebaseUid, latitude, longitude)
      OUTPUT INSERTED.alert_id
      VALUES (@uid, @lat, @lon);
    `;

    const result = await pool
      .request()
      .input("uid", sql.NVarChar, uid)
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
              firebaseUid,
              latitude,
              longitude,
              -- Fórmula de Haversine
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
      -- Filtramos los resultados por la distancia calculada
      SELECT firebaseUid, latitude, longitude, distanceInKm
      FROM AlertsWithDistance
      WHERE distanceInKm <= @radiusKm
      ORDER BY distanceInKm; -- Opcional: ordenar por el más cercano
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