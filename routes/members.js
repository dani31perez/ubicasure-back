const express = require("express");
const router = express.Router();
const { poolPromise } = require("../config/dbConfig");
const bcrypt = require("bcryptjs");
const SALT_ROUNDS = 10;
const requireRole = require("../middleware/requireRole");
const {authenticateMember, signMemberToken} = require("../middleware/jwt");
const {createTelegramLink, processTelegramUpdate} = require("../config/telegram.js");

router.put("/fcmToken", authenticateMember, async (req, res) => {
  try {
    const { fcmToken } = req.body;

    if (!fcmToken) {
      return res.status(400).json({
        error: "Falta el token FCM.",
      });
    }

    const member = req.member;

    const pool = await poolPromise;

    await pool.execute(
      "UPDATE Members SET fcmToken = ? WHERE email = ? AND stationId = ?",
      [fcmToken, member.email, member.stationId]
    );

    return res.status(200).json({
      message: "Token FCM actualizado correctamente.",
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.put(
  "/togglePosition/:email",
  authenticateMember, 
  requireRole("Jefe de Estacion"),
  async (req, res) => {
  try {
    const { email } = req.params;

    if (!email) {
      return res.status(400).json({ msg: "El email es requerido" });
    }

    const findQuery = "SELECT position FROM Members WHERE email = ? AND stationId = ?";
    const pool = await poolPromise;
    const [findResult] = await pool.execute(findQuery, [email, req.member.stationId]);

    if (findResult.length === 0) {
      return res.status(404).json({ msg: "Miembro no encontrado." });
    }

    const currentPosition = findResult[0].position;

    const newPosition =
      currentPosition === "Jefe de Estacion" ? "Miembro" : "Jefe de Estacion";

    const updateQuery = `
      UPDATE Members
      SET position = ?
      WHERE email = ? AND stationId = ?;
    `;

    await pool.execute(updateQuery, [newPosition, email, req.member.stationId]);

    res.status(200).json({
      msg: `Posicion actualizada a: ${newPosition}`,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/getByStation/:stationId", authenticateMember, async (req, res) => {
  try {
    const { stationId } = req.member;
    const pool = await poolPromise;

    const findQuery = `
      SELECT email, fullName, phone, position, stationId
      FROM Members
      WHERE stationId = ?
    `;

    const [members] = await pool.execute(findQuery, [stationId]);

    if (members.length === 0) {
      return res
        .status(404)
        .json({ msg: "No se encontraron miembros para esa estacion." });
    }

    res.status(200).send(members.map(member => ({ ...member, station: req.member.station })));
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

router.post("/", authenticateMember, async (req, res) => {
  try {
    const { email, fullName, phone, position } = req.body;

    if (position === "Jefe de Estacion" && req.member.position !== "Jefe de Estacion") {
      return res.status(403).json({ msg: "Solo un jefe puede registrar a otro jefe de estación." });
    }

    if (!email || !fullName || !phone || !position) {
      return res.status(400).json({
        msg: "Email, nombre completo, teléfono, y posición son requeridos.",
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
      INSERT INTO Members (email, fullName, phone, position, stationId, code)
      VALUES (?, ?, ?, ?, ?, ?);
    `;

    await pool.execute(query, [
      email,
      fullName,
      phone,
      position,
      req.member.stationId,
      codeHash,
    ]);

    res.status(201).json({
      msg: "Miembro registrado exitosamente.",
      code,
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ msg: "El correo ya está registrado." });
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
    const [result] = await pool.execute(`SELECT m.email, m.fullName, m.phone, m.position, m.code, m.stationId, s.name AS station
       FROM Members m JOIN Stations s ON s.stationId = m.stationId`);

    let matched = null;
    for (const member of result) {
      if (await bcrypt.compare(code, member.code)) {
        matched = member;
        break;
      }
    }

    if (matched) {
      const { code: _codeHash, ...miembro } = matched;
      const token = signMemberToken(miembro);

      res.status(200).json({
        msg: "Ingreso exitoso.",
        token,
        miembro,
      });
    } else {
      res.status(401).json({ msg: "Código inválido o no encontrado." });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put(
  "/resetCode",
  authenticateMember,
  requireRole("Jefe de Estacion"),
  async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ msg: "El email es requerido." });
    }

    const pool = await poolPromise;
    const [findResult] = await pool.execute(
      "SELECT position FROM Members WHERE email = ? AND stationId = ?",
      [email, req.member.stationId]
    );

    if (findResult.length === 0) {
      return res.status(404).json({ msg: "Miembro no encontrado." });
    }

    const code = await generateUniqueCode(pool);
    const codeHash = await bcrypt.hash(code, SALT_ROUNDS);

    await pool.execute("UPDATE Members SET code = ? WHERE email = ? AND stationId = ?", [
      codeHash,
      email,
      req.member.stationId,
    ]);

    res.status(200).json({
      msg: "Código actualizado exitosamente.",
      code,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/update/:email", authenticateMember, async (req, res) => {
  try {
    const { email } = req.params;
    const { fullName, phone } = req.body;

    if (!email) {
      return res.status(400).json({ msg: "El email es requerido." });
    }

    const isSelf = req.member.email === email;
    const isJefe = req.member.position === "Jefe de Estacion";

    if (!isSelf && !isJefe) {
      return res.status(403).json({
        msg: "No tenés permiso para editar los datos de otro miembro.",
      });
    }

    if (!fullName || !phone) {
      return res.status(400).json({
        msg: "Faltan campos: nombre completo y teléfono son requeridos.",
      });
    }

    const fields = ["fullName = ?", "phone = ?"];
    const values = [fullName, phone];

    const pool = await poolPromise;
    const [existing] = await pool.execute(
      "SELECT position FROM Members WHERE email = ? AND stationId = ?",
      [email, req.member.stationId]
    );

    if (existing.length === 0) {
      return res.status(404).json({ msg: "Miembro no encontrado." });
    }

    const query = `UPDATE Members SET ${fields.join(", ")} WHERE email = ? AND stationId = ?`;
    values.push(email, req.member.stationId);

    await pool.execute(query, values);

    res.status(200).json({ msg: "Miembro actualizado exitosamente." });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/link", authenticateMember, async (req, res) => {
  try {
    const { email, stationId } = req.member;

    const telegramLink = await createTelegramLink(
      email,
      stationId
    );

    return res.status(200).json({ success: true, telegramLink,});
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post("/webhook", async (req, res) => {
  try {
    await processTelegramUpdate(req.body);

    return res.sendStatus(200);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
