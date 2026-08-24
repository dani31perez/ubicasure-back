const express = require("express");
const router = express.Router();
const { poolPromise } = require("../dbConfig");

router.post("/register", async (req, res) => {
  try {
    const {
      firebaseUid,
      email,
      fullName,
      phone,
      birthDate,
      bloodType,
      telegramUsername,
    } = req.body;

    if (!email || !fullName || !phone || !birthDate || !bloodType) {
      return res.status(400).json({
        msg: "Email, nombre completo, fecha de nacimiento, teléfono y tipo de sangre son requeridos.",
      });
    }

    const pool = await poolPromise;
    const [userExistsResult] = await pool
      .execute(
        "SELECT COUNT(*) as userCount FROM Users WHERE firebaseUid = ?",
        [firebaseUid]
      );

    if (userExistsResult[0].userCount > 0) {
      return res
        .status(409)
        .json({ msg: "Este usuario ya tiene un perfil registrado." });
    }

    const query = `
      INSERT INTO Users (firebaseUid, email, fullName, phone, birthDate, bloodType, telegramUsername, reliability)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?);
    `;

    await pool.execute(query, [
      firebaseUid,
      email,
      fullName,
      phone,
      birthDate,
      bloodType,
      telegramUsername || null,
      100,
    ]);

    res.status(201).json({ msg: "Usuario registrado exitosamente." });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
