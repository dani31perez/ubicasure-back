const express = require("express");
const router = express.Router();
const { sql, poolPromise } = require("../dbConfig");

router.post("/", async (req, res) => {
  const { stationName, memberCode, userEmail, content } = req.body;

  if (!stationName || !memberCode || !userEmail || !content) {
    return res.status(400).json({
      error:
        "Faltan los campos nombre de la estacion, codigo, email o contenido.",
    });
  }

  try {
    const pool = await poolPromise;
    const query = `
      INSERT INTO Reports (stationName, memberCode, userEmail, content)
      OUTPUT INSERTED.reportId
      VALUES (@stationName, @memberCode, @userEmail, @content);
    `;

    const result = await pool
      .request()
      .input("stationName", sql.NVarChar, stationName)
      .input("memberCode", sql.NVarChar, memberCode)
      .input("userEmail", sql.NVarChar, userEmail)
      .input("content", sql.NVarChar(sql.MAX), content)
      .query(query);

    res.status(201).json({
      message: "Reporte creado exitosamente.",
      reportId: result.recordset[0].reportId,
    });
  } catch (error) {
    console.error("Error al crear reporte en SQL Server:", error);

    res
      .status(500)
      .json({ error: "Error interno del servidor.", details: error.message });
  }
});

router.get("/getByStation", async (req, res) => {
  const { stationName } = req.query;

  if (!stationName) {
    return res
      .status(400)
      .json({ error: "Falta el parametro de consulta nombre de la estacion" });
  }

  try {
    const pool = await poolPromise;
    const query = `
      SELECT *
      FROM Reports
      WHERE stationName = @stationName
      ORDER BY createdAt DESC;
    `;

    const result = await pool
      .request()
      .input("stationName", sql.NVarChar, stationName)
      .query(query);

    res.status(200).json(result.recordset);
  } catch (error) {
    console.error("Error al buscar reportes por estación:", error);
    res
      .status(500)
      .json({ error: "Error interno del servidor.", details: error.message });
  }
});

module.exports = router;
