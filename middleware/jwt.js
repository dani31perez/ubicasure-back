const jwt = require("jsonwebtoken")

const signMemberToken = (member) => {
  return jwt.sign(
    {
      email: member.email,
      station: member.station,
      position: member.position,
    },
    process.env.MEMBER_JWT_SECRET,
    { expiresIn: "30d" }
  );
};

const verifyMemberToken = (token) => {
  return jwt.verify(token, process.env.MEMBER_JWT_SECRET);
};


const authenticateMember = (req, res, next) => {
  const authHeader = req.headers["authorization"];

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ msg: "Token no proporcionado." });
  }

  const token = authHeader.split(" ")[1];

  try {
    req.member = verifyMemberToken(token);
    next();
  } catch (err) {
    return res.status(403).json({ msg: "Token inválido o expirado." });
  }
};

module.exports = {authenticateMember, signMemberToken};
