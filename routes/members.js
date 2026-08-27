const express = require("express");
const router = express.Router();
const { poolPromise } = require("../dbConfig");
const bcrypt = require("bcryptjs");
const SALT_ROUNDS = 10;

router.put("/togglePosition/:email", async (req, res) => {
  try {
    const { email } = req.params;

    if (!email) {
      return res.status(400).json({ msg: "El email es requerido" });
    }

    const findQuery = "SELECT * FROM Members WHERE email = ?";
    const pool = await poolPromise;
    const [findResult] = await pool.execute(findQuery, [email]);

    if (findResult.length === 0) {
      return res.status(404).json({ msg: "Miembro no encontrado." });
    }

    const currentPosition = findResult[0].position;

    const newPosition =
      currentPosition === "Jefe de Estacion" ? "Miembro" : "Jefe de Estacion";

    const updateQuery = `
      UPDATE Members
      SET position = ?
      WHERE email = ?;
    `;

    await pool.execute(updateQuery, [newPosition, email]);

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

    const sanitized = members.map(({ code, ...rest }) => rest);

    res.status(200).send(sanitized);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const generateUniqueCode = async (pool) => {
  const [existing] = await pool.execute("SELECT code FROM Members");
  const existingHashes = existing.map((row) => row.code);

  for (let i = 0; i < 5; i++) {
    const candidate = Math.floor(100000 + Math.random() * 900000).toString();

    let collision = false;
    for (const hash of existingHashes) {
      if (await bcrypt.compare(candidate, hash)) {
        collision = true;
        break;
      }
    }

    if (!collision) return candidate;
  }

  throw new Error(
    "No se pudo generar un código único después de varios intentos."
  );
};

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

    const code = await generateUniqueCode(pool);
    const codeHash = await bcrypt.hash(code, SALT_ROUNDS);

    const query = `
      INSERT INTO Members (email, fullName, phone, position, station, code)
      VALUES (?, ?, ?, ?, ?, ?);
    `;

    await pool.execute(query, [
      email,
      fullName,
      phone,
      position,
      station,
      codeHash,
    ]);

    res.status(201).json({
      msg: "Miembro registrado exitosamente.",
      code,
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
    const [result] = await pool.execute("SELECT * FROM Members");

    let matched = null;
    for (const member of result) {
      if (await bcrypt.compare(code, member.code)) {
        matched = member;
        break;
      }
    }

    if (matched) {
      const { code: _codeHash, ...miembro } = matched;
      res.status(200).json({
        msg: "Ingreso exitoso.",
        miembro,
      });
    } else {
      res.status(401).json({ msg: "Código inválido o no encontrado." });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/resetCode", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ msg: "El email es requerido." });
    }

    const pool = await poolPromise;
    const [findResult] = await pool.execute(
      "SELECT * FROM Members WHERE email = ?",
      [email]
    );

    if (findResult.length === 0) {
      return res.status(404).json({ msg: "Miembro no encontrado." });
    }

    const code = await generateUniqueCode(pool);
    const codeHash = await bcrypt.hash(code, SALT_ROUNDS);

    await pool.execute("UPDATE Members SET code = ? WHERE email = ?", [
      codeHash,
      email,
    ]);

    res.status(200).json({
      msg: "Código actualizado exitosamente.",
      code,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/update/:email", async (req, res) => {
  try {
    const { email } = req.params;
    const { fullName, phone, station } = req.body;

    if (!email) {
      return res.status(400).json({ msg: "El email es requerido." });
    }

    if (!fullName || !phone || !station) {
      return res.status(400).json({
        msg: "Faltan campos: nombre completo, teléfono y estación son requeridos.",
      });
    }

    const fields = ["fullName = ?", "phone = ?", "station = ?"];
    const values = [fullName, phone, station];

    const pool = await poolPromise;
    const [existing] = await pool.execute(
      "SELECT * FROM Members WHERE email = ?",
      [email]
    );

    if (existing.length === 0) {
      return res.status(404).json({ msg: "Miembro no encontrado." });
    }

    const query = `UPDATE Members SET ${fields.join(", ")} WHERE email = ?`;
    values.push(email);

    await pool.execute(query, values);

    res.status(200).json({ msg: "Miembro actualizado exitosamente." });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
