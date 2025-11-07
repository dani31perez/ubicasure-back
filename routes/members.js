const express = require("express");
const router = express.Router();
const { sql, poolPromise } = require("../dbConfig");

router.put("/togglePosition/:code", async (req, res) => {
  try {
    const { code } = req.params;

    if (!code) {
      return res.status(400).json({ msg: "El codigo es requerido" });
    }

    const pool = await poolPromise;

    const findQuery = "SELECT * FROM miembros WHERE code = @code";
    const findResult = await pool
      .request()
      .input("code", sql.NVarChar, code)
      .query(findQuery);

    if (findResult.recordset.length === 0) {
      return res.status(404).json({ msg: "Miembro no encontrado." });
    }

    const currentPosition = findResult.recordset[0].position;

    const newPosition =
      currentPosition === "Jefe de Estacion" ? "Miembro" : "Jefe de Estacion";

    const updateQuery = `
      UPDATE Members
      SET position = @newPosition
      WHERE code = @code;
    `;

    await pool
      .request()
      .input("newPosition", sql.NVarChar, newPosition)
      .input("code", sql.NVarChar, code)
      .query(updateQuery);

    res.status(200).json({
      msg: `Posicion actualizada a: ${newPosition}`,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/getByStation/:station", async (req, res) => {
  try {
    const { station } = req.params;

    if (!station) {
      return res.status(400).json({ msg: "La estacion es requerida" });
    }

    const pool = await poolPromise;

    const findQuery = "SELECT * FROM Members WHERE station = @station";
    const members = await pool
      .request()
      .input("station", sql.NVarChar, station)
      .query(findQuery);

    if (members.recordset.length === 0) {
      return res
        .status(404)
        .json({ msg: "No se encontraron Members para esa estacion." });
    }

    res.status(200).send(members.recordset);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const { email, fullName, phone, position, station } = req.body;

    if (!email || !fullName || !phone || !position || !station) {
      return res.status(400).json({
        msg: "Email, nombre completo, teléfono, posición y estacion son requeridos.",
      });
    }

    const pool = await poolPromise;

    const userExistsResult = await pool
      .request()
      .input("email", sql.NVarChar, email)
      .query("SELECT COUNT(*) as userCount FROM Members WHERE email = @email");

    if (userExistsResult.recordset[0].userCount > 0) {
      return res
        .status(409)
        .json({ msg: "Este miembro ya tiene un perfil registrado." });
    }

    const query = `
      INSERT INTO Members (email, fullName, phone, position, station)
      OUTPUT INSERTED.* VALUES (@email, @fullName, @phone, @position, @station);
    `;

    const result = await pool
      .request()
      .input("email", sql.NVarChar, email)
      .input("fullName", sql.NVarChar, fullName)
      .input("phone", sql.VarChar, phone)
      .input("position", sql.NVarChar, position)
      .input("station", sql.NVarChar, station)
      .query(query);

    const nuevoMiembro = result.recordset[0];

    res.status(201).json({
      msg: "Miembro registrado exitosamente.",
      code: nuevoMiembro.code,
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

    const query = "SELECT * FROM Members WHERE code = @code";

    const result = await pool
      .request()
      .input("code", sql.Char, code)
      .query(query);

    if (result.recordset.length > 0) {
      const { code, ...miembro } = result.recordset[0];
      res.status(200).json({
        msg: "Ingreso exitoso.",
        miembro: miembro,
      });
    } else {
      res.status(401).json({ msg: "Código inválido o no encontrado." });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
