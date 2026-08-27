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

router.get("/getByEmail/:email", async (req, res) => {
  try {
    const { email } = req.params;

    if (!email) {
      return res.status(400).json({ msg: "El email es requerido." });
    }

    const pool = await poolPromise;
    const [users] = await pool.execute(
      "SELECT * FROM Users WHERE email = ?",
      [email]
    );

    if (users.length === 0) {
      return res.status(404).json({ msg: "Usuario no encontrado." });
    }

    res.status(200).json(users[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/update/:email", async (req, res) => {
  try {
    const { email } = req.params;
    const { fullName, phone, birthDate, bloodType, telegramUsername } =
      req.body;

    if (!email) {
      return res.status(400).json({ msg: "El email es requerido." });
    }

    if (!fullName || !phone || !birthDate || !bloodType || !telegramUsername) {
      return res.status(400).json({
        msg: "Faltan campos: nombre completo, teléfono, fecha de nacimiento, tipo de sangre y usuario de Telegram son requeridos.",
      });
    }

    const fields = [
      "fullName = ?",
      "phone = ?",
      "birthDate = ?",
      "bloodType = ?",
      "telegramUsername = ?",
    ];
    const values = [fullName, phone, birthDate, bloodType, telegramUsername];

    const pool = await poolPromise;
    const [existing] = await pool.execute(
      "SELECT * FROM Users WHERE email = ?",
      [email]
    );

    if (existing.length === 0) {
      return res.status(404).json({ msg: "Usuario no encontrado." });
    }

    const query = `UPDATE Users SET ${fields.join(", ")} WHERE email = ?`;
    values.push(email);

    await pool.execute(query, values);

    res.status(200).json({ msg: "Usuario actualizado exitosamente." });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
