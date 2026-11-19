const express = require("express");
const router = express.Router();
const { fetchNearbyPlaces, fetchPlaceDetails, parseSearch } = require("../utils/places");

router.get("/getApiKey", (_req, res) => {
  res.status(200).json(process.env.GOOGLE_MAPS_API_KEY);
});

router.get("/fireStations", async (req, res) => {
  const { guatemalaCityLocation, searchRadius } = req.query;
  try {
    const nearbyStations = await fetchNearbyPlaces(
      "fire_station",
      guatemalaCityLocation,
      searchRadius,
      process.env.GOOGLE_MAPS_API_KEY
    );
    const fireStations = nearbyStations.map(station => ({
      place_id: station.place_id,
      name: station.name,
      type: "fire_station",
      location: station.geometry.location,
    }));
    res.json(fireStations);
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.status ? error.message : "No fue posible consultar las estaciones.",
      reason: error.reason,
      googleStatus: error.googleStatus,
    });
  }
});

router.get("/policeStations", async (req, res) => {
  const { guatemalaCityLocation, searchRadius } = req.query;
  try {
    const nearbyStations = await fetchNearbyPlaces(
      "police",
      guatemalaCityLocation,
      searchRadius,
      process.env.GOOGLE_MAPS_API_KEY
    );
    const policeStations = nearbyStations.map(station => ({
      place_id: station.place_id,
      name: station.name,
      type: "police",
      location: station.geometry.location,
    }));
    res.json(policeStations);
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.status ? error.message : "No fue posible consultar las estaciones.",
      reason: error.reason,
      googleStatus: error.googleStatus,
    });
  }
});

router.get("/details/:placeId", async (req, res) => {
  if (!/^[A-Za-z0-9_-]{1,255}$/.test(req.params.placeId)) {
    return res.status(400).json({ error: "Identificador de lugar inválido." });
  }
  try {
    const place = await fetchPlaceDetails(req.params.placeId, process.env.GOOGLE_MAPS_API_KEY);
    res.json({
      place_id: place.place_id, name: place.name,
      type: place.types?.includes("fire_station") ? "fire_station" : place.types?.includes("police") ? "police" : null,
      address: place.vicinity, location: place.geometry.location,
      phone: place.formatted_phone_number || null, international_phone: place.international_phone_number || null,
      opening_hours: place.opening_hours?.weekday_text || [], opening_periods: place.opening_hours?.periods || [],
      open_now: place.open_now, website: place.website || null, maps_url: place.maps_url,
      business_status: place.business_status || null, attributions: place.attributions,
    });
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.status ? error.message : "No fue posible consultar las estaciones.",
      reason: error.reason,
      googleStatus: error.googleStatus,
    });
  }
});

router.get("/", async (req, res) => {
  try {
    const { guatemalaCityLocation, searchRadius } = req.query;
    parseSearch(guatemalaCityLocation, searchRadius);
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    const [fire, police] = await Promise.all([
      fetchNearbyPlaces("fire_station", guatemalaCityLocation, searchRadius, apiKey),
      fetchNearbyPlaces("police", guatemalaCityLocation, searchRadius, apiKey),
    ]);
    res.json({
      fire_stations: fire.map(station => ({
        place_id: station.place_id,
        name: station.name,
        type: "fire_station",
        location: station.geometry.location,
      })),
      police_stations: police.map(station => ({
        place_id: station.place_id,
        name: station.name,
        type: "police",
        location: station.geometry.location,
      })),
    });
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.status ? error.message : "No fue posible consultar las estaciones.",
      reason: error.reason,
      googleStatus: error.googleStatus,
    });
  }
});

module.exports = router;
