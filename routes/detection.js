const express = require("express");
const router = express.Router();
const {authenticateMember} = require("../middleware/jwt");
const { detectIncident } = require("../utils");

router.post("/analyze", authenticateMember, async (req, res) => {
  const { imageUrl } = req.body;

  if (!imageUrl) {
    return res.status(400).json({ error: "Falta la URL de la imagen." });
  }

  try {
    const result = await detectIncident(imageUrl);
    res.status(200).json(result);
  } catch (error) {
    console.error("Error al llamar al servicio de análisis:", error);
    res.status(error.status || 500).json({
      error: "Error interno del servidor.",
      details: error.details || error.message,
    });
  }
});

module.exports = router;