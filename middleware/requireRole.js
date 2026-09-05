
const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.member) {
      return res.status(401).json({ msg: "No autenticado." });
    }

    if (!allowedRoles.includes(req.member.position)) {
      return res
        .status(403)
        .json({ msg: "Sin permiso para realizar esta acción." });
    }

    next();
  };
};

module.exports = requireRole;
