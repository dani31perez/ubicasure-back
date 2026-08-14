const express = require("express");
const router = express.Router();
const { poolPromise } = require("../dbConfig");

router.put("/togglePosition/:code", async (req, res) => {
  try {
    const { code } = req.params;

    if (!code) {
      return res.status(400).json({ msg: "El codigo es requerido" });
    }

    const findQuery = "SELECT * FROM Members WHERE code = ?";
    const pool = await poolPromise;
    const [findResult] = await pool.execute(findQuery, [code]);

    if (findResult.length === 0) {
      return res.status(404).json({ msg: "Miembro no encontrado." });
    }

    const currentPosition = findResult.position;

    const newPosition =
      currentPosition === "Jefe de Estacion" ? "Miembro" : "Jefe de Estacion";

    const updateQuery = `
      UPDATE Members
      SET position = ?
      WHERE code = ?;
    `;

    await pool.execute(updateQuery), [newPosition, code];

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

    const findQuery = "SELECT * FROM Members WHERE station = ?";
    const pool = await poolPromise;
    const [members] = await pool.execute(findQuery, [station]);

    if (members.length === 0) {
      return res
        .status(404)
        .json({ msg: "No se encontraron Members para esa estacion." });
    }

    res.status(200).send(members);
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
    const [userExistsResult] = await pool
    .execute("SELECT COUNT(*) as userCount FROM Members WHERE email = ?", [email]);

    if (userExistsResult[0].userCount > 0) {
      return res
        .status(409)
        .json({ msg: "Este miembro ya tiene un perfil registrado." });
    }

    const query = `
      INSERT INTO Members (email, fullName, phone, position, station, code)
      VALUES (?, ?, ?, ?, ?, ?);
    `;
    let inserted = false;

        for (let i = 0; i < 5; i++) {
          const code = Math.floor(100000 + Math.random() * 900000).toString();
          try {
            await pool.execute(insertQuery, [
              email,
              fullName,
              phone,
              position,
              station,
              code,
            ]);

            inserted = true;
            res.status(201).json({
              msg: "Miembro registrado exitosamente.",
              code,
            });
            break; 
          } catch (error) {
            if (error.code === "ER_DUP_ENTRY" && error.message.includes("code")) {
              continue; 
            }
            throw error; 
          }
        }

        if (!inserted) {
          throw new Error(
            "No se pudo generar un código único después de varios intentos."
          );
        }
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

    const query = "SELECT * FROM Members WHERE code = ?";
    const pool = await poolPromise;
    const [result] = await pool.execute(query, [code]);

    if (result.length > 0) {
      const { code, ...miembro } = result[0];
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
