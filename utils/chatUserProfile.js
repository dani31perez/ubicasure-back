const { normalizeReliability, reliabilityLevel } = require("./userReliability");

function createChatUserProfileHandler({ poolPromise, db }) {
  return async (req, res) => {
    res.set("Cache-Control", "no-store");
    const chatId = req.params.chatId;
    if (typeof chatId !== "string" || !chatId.trim() || chatId.length > 1500 || chatId.includes("/")) {
      return res.status(400).json({ error: "El identificador del chat no es válido." });
    }
    try {
      const snapshot = await db.collection("chats").doc(chatId).get();
      if (!snapshot.exists) return res.status(404).json({ error: "Chat no encontrado." });
      const chat = snapshot.data();
      const pool = await poolPromise;
      let allowed = Number(chat.stationId) === req.member.stationId;
      if (chat.stationId == null && typeof chat.users?.[1] === "string") {
        // Compatibilidad con chats previos a stationId, sin confundir estaciones homónimas.
        const [stations] = await pool.execute("SELECT stationId FROM Stations WHERE name = ? LIMIT 2", [chat.users[1]]);
        allowed = stations.length === 1 && Number(stations[0].stationId) === req.member.stationId;
      }
      if (!allowed) return res.status(403).json({ error: "Este chat no pertenece a tu estación." });
      const email = chat.users?.[0];
      if (typeof email !== "string" || !email.trim()) {
        return res.status(404).json({ error: "No se pudo identificar al usuario del chat." });
      }
      const [users] = await pool.execute(`
        SELECT email, fullName, phone, DATE_FORMAT(birthDate, '%Y-%m-%d') AS birthDate,
               bloodType, telegramUsername, reliability,
               TIMESTAMPDIFF(YEAR, birthDate, DATE(UTC_TIMESTAMP() - INTERVAL 6 HOUR)) AS age
        FROM Users WHERE email = ?
      `, [email]);
      if (!users.length) return res.status(404).json({ error: "Usuario no encontrado." });
      const user = users[0];
      const reliability = normalizeReliability(user.reliability);
      return res.status(200).json({
        email: user.email, fullName: user.fullName, phone: user.phone,
        birthDate: user.birthDate, bloodType: user.bloodType,
        telegramUsername: user.telegramUsername,
        age: user.age == null || Number(user.age) < 0 ? null : Number(user.age),
        reliability, reliabilityLevel: reliabilityLevel(reliability),
      });
    } catch (error) {
      console.error("chat.user_profile.error", { code: error.code });
      return res.status(500).json({ error: "No se pudo consultar la información del usuario." });
    }
  };
}

module.exports = { createChatUserProfileHandler };
