const jwt = require("jsonwebtoken");
const { poolPromise } = require("../config/dbConfig");

const signMemberToken = (member) => {
  return jwt.sign(
    {
      email: member.email,
      station: member.station,
      stationId: member.stationId,
      position: member.position,
    },
    process.env.MEMBER_JWT_SECRET,
    { expiresIn: "30d" }
  );
};

const verifyMemberToken = (token) => {
  return jwt.verify(token, process.env.MEMBER_JWT_SECRET);
};


const authenticateMember = async (req, res, next) => {
  const authHeader = req.headers["authorization"];

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ msg: "Token no proporcionado." });
  }

  const token = authHeader.split(" ")[1];

  try {
    req.member = verifyMemberToken(token);
    if (!Number.isSafeInteger(req.member.stationId) || req.member.stationId <= 0) {
      return res.status(401).json({ msg: "Vuelve a iniciar sesión para actualizar tu estación." });
    }
    const suppliedIds = [req.params?.stationId, req.query?.stationId, req.body?.stationId];
    if (suppliedIds.some(id => id !== undefined && id !== req.member.stationId && id !== String(req.member.stationId))) {
      return res.status(403).json({ msg: "La estación solicitada no corresponde al miembro." });
    }
  } catch (err) {
    return res.status(403).json({ msg: "Token inválido o expirado." });
  }

  try {
    const pool = await poolPromise;
    const [members] = await pool.execute(
      "SELECT position FROM Members WHERE email = ? AND stationId = ?",
      [req.member.email, req.member.stationId]
    );
    if (!members.length) return res.status(401).json({ msg: "Vuelve a iniciar sesión." });
    req.member.position = members[0].position;
  } catch {
    return res.status(503).json({ msg: "No se pudo verificar la pertenencia a la estación." });
  }
  next();
};

module.exports = {authenticateMember, signMemberToken};
