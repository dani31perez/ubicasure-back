const express = require("express");
const router = express.Router();
const { sql, poolPromise } = require("../dbConfig");
const admin = require("firebase-admin");

router.post("/setRole", async (req, res) => {
  const { uid, rol } = req.body;
  try {
    await admin.auth().setCustomUserClaims(uid, { role: rol });
    res.send({ message: "Rol asignado" });
  } catch (e) {
    res.status(500).send({ error: e.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const { email, fullName, phone, position, station } = req.body;

    if (!email || !fullName || !phone || !position || !station) {
      return res.status(400).json({
        msg: "Email, nombre completo, teléfono, posición y estación son requeridos.",
      });
    }

    const pool = await poolPromise;

    const userExistsResult = await pool
      .request()
      .input("email", sql.NVarChar, email)
      .query("SELECT COUNT(*) as userCount FROM miembros WHERE email = @email");

    if (userExistsResult.recordset[0].userCount > 0) {
      return res
        .status(409)
        .json({ msg: "Este miembro ya tiene un perfil registrado." });
    }

    const query = `
      INSERT INTO miembros (email, fullName, phone, position, station)
      OUTPUT INSERTED.* VALUES (@email, @fullName, @phone, @position, @station);
    `;

    await pool
      .request()
      .input("email", sql.NVarChar, email)
      .input("fullName", sql.NVarChar, fullName)
      .input("phone", sql.VarChar, phone)
      .input("position", sql.NVarChar, position)
      .input("station", sql.NVarChar, station)
      .query(query);

    res.status(201).json({
      msg: "Miembro registrado exitosamente.",
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { code } = req.body;

    if (!code || code.length !== 6) {
      return res.status(400).json({
        msg: "El código es requerido y debe tener 6 dígitos.",
      });
    }

    const pool = await poolPromise;

    const query = "SELECT * FROM miembros WHERE code = @code";

    const result = await pool
      .request()
      .input("code", sql.Char, code)
      .query(query);

    if (result.recordset.length > 0) {
      const {code, ...miembro} = result.recordset[0];
      res.status(200).json({
        msg: "Ingreso exitoso.",
        miembro: miembro 
      });
    } else {
      res.status(401).json({ msg: "Código inválido o no encontrado." });
    }
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
