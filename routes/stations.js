const express = require("express");
const router = express.Router();
const { fetchNearbyPlaces, fetchPlaceDetails } = require("../utils");
require("dotenv").config();

const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;

router.get("/getApiKey", async (_req, res) => {
  res.status(200).json(process.env.GOOGLE_MAPS_API_KEY);
});

router.get("/fireStations", async (req, res) => {
  const { guatemalaCityLocation, searchRadius } = req.query;
  try {
    const nearbyStations = await fetchNearbyPlaces(
      "fire_station",
      guatemalaCityLocation,
      searchRadius,
      googleMapsApiKey
    );
    const detailPromises = nearbyStations.map((station) =>
      fetchPlaceDetails(station.place_id, googleMapsApiKey)
    );

    const stationsWithDetails = await Promise.all(detailPromises);

    const fireStations = stationsWithDetails
      .filter((station) => station !== null)
      .map((station) =>
        station.opening_hours != null
          ? {
              name: station.name,
              type: "fire_station",
              address: station.vicinity,
              location: station.geometry.location,
              phone: station.formatted_phone_number,
              opening_hours: station.opening_hours.weekday_text,
            }
          : {
              name: station.name,
              type: "fire_station",
              address: station.vicinity,
              location: station.geometry.location,
              phone: station.formatted_phone_number,
            }
      );

    res.json(fireStations);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/policeStations", async (req, res) => {
  const { guatemalaCityLocation, searchRadius } = req.query;
  try {
    const nearbyStations = await fetchNearbyPlaces(
      "police",
      guatemalaCityLocation,
      searchRadius,
      googleMapsApiKey
    );

    const detailPromises = nearbyStations.map((station) =>
      fetchPlaceDetails(station.place_id, googleMapsApiKey)
    );

    const stationsWithDetails = await Promise.all(detailPromises);

    const policeStations = stationsWithDetails
      .filter((station) => station !== null)
      .map((station) =>
        station.opening_hours != null
          ? {
              name: station.name,
              type: "police",
              address: station.vicinity,
              location: station.geometry.location,
              phone: station.formatted_phone_number,
              opening_hours: station.opening_hours.weekday_text,
            }
          : {
              name: station.name,
              type: "police",
              address: station.vicinity,
              location: station.geometry.location,
              phone: station.formatted_phone_number,
            }
      );

    res.json(policeStations);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/", async (req, res) => {
  const { guatemalaCityLocation, searchRadius } = req.query;
  try {
    const [nearbyFireStations, nearbyPoliceStations] = await Promise.all([
      fetchNearbyPlaces(
        "fire_station",
        guatemalaCityLocation,
        searchRadius,
        googleMapsApiKey
      ),
      fetchNearbyPlaces(
        "police",
        guatemalaCityLocation,
        searchRadius,
        googleMapsApiKey
      ),
    ]);
    const fireDetailPromises = nearbyFireStations.map((station) =>
      fetchPlaceDetails(station.place_id, googleMapsApiKey)
    );
    // 3. Crear promesas de detalles para policía
    const policeDetailPromises = nearbyPoliceStations.map((station) =>
      fetchPlaceDetails(station.place_id, googleMapsApiKey)
    );

    // 4. Esperar a que TODAS las llamadas de detalles terminen
    const [fireStationsWithDetails, policeStationsWithDetails] =
      await Promise.all([
        Promise.all(fireDetailPromises),
        Promise.all(policeDetailPromises),
      ]);

    const fireStations = fireStationsWithDetails
      .filter((station) => station !== null)
      .map((station) =>
        station.opening_hours != null
          ? {
              name: station.name,
              type: "fire_station",
              address: station.vicinity,
              location: station.geometry.location,
              phone: station.formatted_phone_number,
              opening_hours: station.opening_hours.weekday_text,
            }
          : {
              name: station.name,
              type: "fire_station",
              address: station.vicinity,
              location: station.geometry.location,
              phone: station.formatted_phone_number,
            }
      );

    const policeStations = policeStationsWithDetails
      .filter((station) => station !== null)
      .map((station) =>
        station.opening_hours != null
          ? {
              name: station.name,
              type: "police",
              address: station.vicinity,
              location: station.geometry.location,
              phone: station.formatted_phone_number,
              opening_hours: station.opening_hours.weekday_text,
            }
          : {
              name: station.name,
              type: "police",
              address: station.vicinity,
              location: station.geometry.location,
              phone: station.formatted_phone_number,
            }
      );

    res.json({
      fire_stations: fireStations,
      police_stations: policeStations,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
