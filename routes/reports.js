const express = require("express");
const router = express.Router();
const { poolPromise } = require("../config/dbConfig");
const {authenticateMember} = require("../middleware/jwt")

router.post("/",  authenticateMember, async (req, res) => {
  const { userEmail, content } = req.body;

  const memberEmail = req.member.email;
  const { stationId } = req.member;

  if (!userEmail || !content) {
    return res.status(400).json({
      error:
        "Faltan los campos correo del usuario o contenido.",
    });
  }

  try {
    const query = `
      INSERT INTO Reports (stationId, memberEmail, userEmail, content)
      VALUES (?, ?, ?, ?);
    `;
    const pool = await poolPromise;
    const [result] = await pool.execute(query, [stationId, memberEmail, userEmail, content]);

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

router.get("/getByStation", authenticateMember, async (req, res) => {
  const { stationId } = req.member;

  try {
    const query = `
      SELECT *
      FROM Reports
      WHERE stationId = ?
      ORDER BY createdAt DESC;
    `;

    const pool = await poolPromise;
    const [result] = await pool.execute(query, [stationId]);

    res.status(200).json(result.map(report => ({ ...report, stationName: req.member.station })));
  } catch (error) {
    console.error("Error al buscar reportes por estación:", error);
    res
      .status(500)
      .json({ error: "Error interno del servidor.", details: error.message });
  }
});

module.exports = router;
