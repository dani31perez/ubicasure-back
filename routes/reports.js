const express = require("express");
const router = express.Router();
const { poolPromise } = require("../dbConfig");

router.post("/", async (req, res) => {
  const { stationName, memberEmail, userEmail, content } = req.body;

  if (!stationName || !memberEmail || !userEmail || !content) {
    return res.status(400).json({
      error:
        "Faltan los campos nombre de la estacion, email del miembro, email del usuario  o contenido.",
    });
  }

  try {
    const query = `
      INSERT INTO Reports (stationName, memberEmail, userEmail, content)
      VALUES (?, ?, ?, ?);
    `;
    const pool = await poolPromise;
    const [result] = await pool.execute(query, [stationName, memberEmail, userEmail, content]);

    res.status(201).json({
      message: "Reporte creado exitosamente.",
      reportId: result.insertId,
    });
  } catch (error) {
    console.error("Error al crear reporte en MySQL", error);

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
    const query = `
      SELECT *
      FROM Reports
      WHERE stationName = ?
      ORDER BY createdAt DESC;
    `;

    const pool = await poolPromise;
    const [result] = await pool.execute(query, [stationName]);

    res.status(200).json(result);
  } catch (error) {
    console.error("Error al buscar reportes por estación:", error);
    res
      .status(500)
      .json({ error: "Error interno del servidor.", details: error.message });
  }
});

module.exports = router;
