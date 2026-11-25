const { alertHasImages, evaluateReliability, reliabilityLevel, normalizeReliability } = require("./userReliability");

function createStationReportHandlers({ poolPromise }) {
  async function candidates(req, res) {
    res.set("Cache-Control", "no-store");
    try {
      const pool = await poolPromise;
      const [rows] = await pool.execute(`
        SELECT a.alertId, a.email AS userEmail, u.fullName AS userName,
               a.images, a.fechaCreacion AS createdAt, u.reliability
        FROM AlertAttendingStations ats
        JOIN Alerts a ON a.alertId = ats.alertId
        JOIN Users u ON u.email = a.email
        WHERE ats.stationId = ?
        ORDER BY a.fechaCreacion DESC, a.alertId DESC
      `, [req.member.stationId]);
      return res.status(200).json(rows.map(row => ({
        alertId: String(row.alertId), userEmail: row.userEmail, userName: row.userName,
        hasImages: alertHasImages(row.images), createdAt: row.createdAt,
        reliability: normalizeReliability(row.reliability), reliabilityLevel: reliabilityLevel(row.reliability),
      })));
    } catch (error) {
      console.error("report.candidates.error", { code: error.code });
      return res.status(500).json({ error: "No se pudieron consultar las alertas para reportar." });
    }
  }

  async function create(req, res) {
    const { alertId, isTruthful, userEmail } = req.body ?? {};
    const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
    if (!["string", "number"].includes(typeof alertId) ||
        !/^[1-9]\d*$/.test(String(alertId)) || !Number.isSafeInteger(Number(alertId))) {
      return res.status(400).json({ error: "Selecciona la alerta atendida que corresponde al reporte." });
    }
    if (typeof isTruthful !== "boolean" || !content) {
      return res.status(400).json({ error: "El contenido y la evaluación de la alerta son obligatorios." });
    }
    if (content.length > 16000) return res.status(400).json({ error: "El reporte es demasiado largo." });
    let connection;
    try {
      const pool = await poolPromise;
      connection = await pool.getConnection();
      await connection.beginTransaction();
      const reject = async (status, error) => {
        await connection.rollback();
        return res.status(status).json({ error });
      };
      // El bloqueo de la alerta serializa evaluaciones de distintas estaciones.
      const [alerts] = await connection.execute("SELECT alertId, email, images FROM Alerts WHERE alertId = ? FOR UPDATE", [alertId]);
      if (!alerts.length) return await reject(404, "Alerta no encontrada.");
      const alert = alerts[0];
      const [attendance] = await connection.execute(
        "SELECT stationId FROM AlertAttendingStations WHERE alertId = ? AND stationId = ?",
        [alertId, req.member.stationId]);
      if (!attendance.length) return await reject(403, "Tu estación debe estar atendiendo esta alerta para generar el reporte.");
      if (userEmail != null && userEmail !== alert.email) {
        return await reject(400, "El usuario seleccionado no corresponde a esta alerta.");
      }
      // El bloqueo del usuario evita perder puntos al evaluar alertas simultáneas.
      const [users] = await connection.execute("SELECT reliability FROM Users WHERE email = ? FOR UPDATE", [alert.email]);
      if (!users.length) return await reject(404, "Usuario no encontrado.");
      const hadImages = alertHasImages(alert.images);
      const evaluation = evaluateReliability(users[0].reliability, {
        isTruthful, hasImages: hadImages,
      });
      const [result] = await connection.execute(`
        INSERT INTO Reports (stationId, memberEmail, userEmail, content)
        VALUES (?, ?, ?, ?)
      `, [req.member.stationId, req.member.email, alert.email, content]);
      await connection.execute("UPDATE Users SET reliability = ? WHERE email = ?", [evaluation.after, alert.email]);
      await connection.commit();
      return res.status(201).json({
        message: "Reporte creado exitosamente.", reportId: result.insertId,
        reliabilityAfter: evaluation.after, reliabilityLevel: reliabilityLevel(evaluation.after),
      });
    } catch (error) {
      if (connection) await connection.rollback().catch(() => {});
      console.error("report.create.error", { code: error.code });
      return res.status(500).json({ error: "No se pudo guardar el reporte. Vuelve a intentarlo." });
    } finally {
      if (connection) connection.release();
    }
  }

  return { create, candidates };
}

module.exports = { createStationReportHandlers };
