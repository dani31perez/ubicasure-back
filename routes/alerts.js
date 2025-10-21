require("dotenv").config();
const express = require("express");
const router = express.Router();
const { Firestore } = require("@google-cloud/firestore");

const db = new Firestore();

function getDistanceInKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) *
      Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

router.post("/", async (req, res) => {
  const { uid, latitude, longitude } = req.body;

  if (!uid || latitude === undefined || longitude === undefined) {
    return res
      .status(400)
      .json({ error: "Faltan los campos uid, latitude, o longitude." });
  }

  try {
    const newAlert = {
      uid,
      latitude,
      longitude,
    };

    const docRef = await db.collection("alerts").add(newAlert);
    res
      .status(201)
      .json({ message: "Alerta creada exitosamente.", alertId: docRef.id });
  } catch (error) {
    console.error("Error al crear alerta en Firestore:", error);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

router.get("/", async (req, res) => {
  const { lat, lon } = req.query;
  const searchRadiusKm = 5;

  if (!lat || !lon) {
    return res
      .status(400)
      .json({ error: "Faltan los parámetros de consulta lat y lon." });
  }

  const userLat = parseFloat(lat);
  const userLon = parseFloat(lon);

  try {
    const snapshot = await db.collection("alerts").get();

    if (snapshot.empty) {
      return res.json([]);
    }

    const allAlerts = [];
    snapshot.forEach((doc) => {
      allAlerts.push(doc.data());
    });

    const nearbyAlerts = allAlerts
      .filter((alert) => {
        if (alert.latitude && alert.longitude) {
          const distance = getDistanceInKm(
            userLat,
            userLon,
            alert.latitude,
            alert.longitude
          );
          return distance <= searchRadiusKm;
        }
        return false;
      })
      .map((alert) => ({
        uid: alert.uid,
        latitude: alert.latitude,
        longitude: alert.longitude,
      }));

    res.status(200).json(nearbyAlerts);
  } catch (error) {
    console.error("Error al buscar alertas cercanas:", error);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

module.exports = router;
