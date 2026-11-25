const express = require("express");
const router = express.Router();
const { poolPromise } = require("../config/dbConfig");
const {authenticateMember} = require("../middleware/jwt")

const { createStationReportHandlers } = require("../utils/stationReports");
const handlers = createStationReportHandlers({ poolPromise });
router.get("/candidates", authenticateMember, handlers.candidates);
router.post("/", authenticateMember, handlers.create);

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

