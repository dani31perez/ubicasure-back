const express = require("express");
const router = express.Router();
const {authenticateMember} = require("../middleware/jwt")

router.post("/analyze", authenticateMember, async (req, res) => {
  const { imageUrl } = req.body;

  if (!imageUrl) {
    return res.status(400).json({ error: "Falta la URL de la imagen." });
  }

  try {
    const response = await fetch(`${process.env.AI_SERVICE_URL}/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.AI_SERVICE_SECRET,
      },
      body: JSON.stringify({ image_url: imageUrl }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return res.status(response.status).json({
        error: "El servicio de análisis devolvió un error.",
        details: errorBody,
      });
    }

    const result = await response.json();
    res.status(200).json(result);
  } catch (error) {
    console.error("Error al llamar al servicio de análisis:", error);
    res.status(500).json({
      error: "Error interno del servidor.",
      details: error.message,
    });
  }
});

module.exports = router;