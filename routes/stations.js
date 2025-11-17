const express = require("express");
const router = express.Router();
const axios = require("axios");
require("dotenv").config();

const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;

async function fetchPlaceDetails(placeId, apiKey) {
  const fields = "name,vicinity,formatted_phone_number,opening_hours,geometry";
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&key=${apiKey}&fields=${fields}&language=es`;

  try {
    const response = await axios.get(url);
    if (response.data.status === "OK") {
      return response.data.result;
    }
    return null;
  } catch (error) {
    console.error(`Error fetching details for ${placeId}:`, error.message);
    return null;
  }
}

async function fetchNearbyPlaces(type, location, radius, apiKey) {
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${location}&radius=${radius}&type=${type}&key=${apiKey}&language=es`;

  try {
    const response = await axios.get(url);
    if (response.data.status === "OK") {
      return response.data.results;
    }
    return [];
  } catch (error) {
    console.error(`Error fetching ${type}:`, error.message);
    throw new Error("Failed to fetch data from Google Maps API.");
  }
}

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
