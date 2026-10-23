const express = require("express");
const router = express.Router();
const {authenticateMember} = require("../middleware/jwt");
const { detectIncident } = require("../utils/utils");
const { obtenerPrediccionesZona } = require("../utils/predictionUtils");

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

router.get("/predictions", async (req, res) => {
  try {
    const resultado = await obtenerPrediccionesZona(req.query);
    res.status(200).json(resultado);
  } catch (error) {
    const status = [400, 422, 502, 503, 504].includes(error.status) ? error.status : 500;
    res.status(status).json({
      error: status === 500 ? "Error interno al consultar las predicciones." : error.message,
    });
  }
});

module.exports = router;