const express = require("express");
const router = express.Router();
const { sql, poolPromise } = require("../dbConfig");
const admin = require("firebase-admin");

router.post("/register", async (req, res) => {
  try {
    const { firebaseUid, email, fullName, phone, birthDate, bloodType } =
      req.body;

    if (!email || !fullName || !phone || !birthDate || !bloodType) {
      return res.status(400).json({
        msg: "Email, nombre completo, fecha de nacimiento, teléfono y tipo de sangre son requeridos.",
      });
    }
    const pool = await poolPromise;

    const userExistsResult = await pool
      .request()
      .input("uid", sql.NVarChar, firebaseUid)
      .query(
        "SELECT COUNT(*) as userCount FROM Users WHERE firebaseUid = @uid"
      );

    if (userExistsResult.recordset[0].userCount > 0) {
      return res
        .status(409)
        .json({ msg: "Este usuario ya tiene un perfil registrado." });
    }

    const query = `
      INSERT INTO Users (firebaseUid, email, fullName, phone, birthDate, bloodType)
      VALUES (@uid, @email, @name, @phone, @bdate, @btype);
    `;

    await pool
      .request()
      .input("uid", sql.NVarChar, firebaseUid)
      .input("email", sql.NVarChar, email)
      .input("name", sql.NVarChar, fullName)
      .input("phone", sql.VarChar, phone)
      .input("bdate", sql.Date, birthDate)
      .input("btype", sql.VarChar, bloodType)
      .query(query);

    res.status(201).json({ msg: "Usuario registrado exitosamente." });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
