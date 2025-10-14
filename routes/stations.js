const express = require('express');
const router = express.Router();
const axios = require('axios');
require('dotenv').config();
 
const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY
   
async function fetchNearbyPlaces(type, location, radius, apiKey) {
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${location}&radius=${radius}&type=${type}&key=${apiKey}&language=es`;
  try {
    const response = await axios.get(url);
    if (response.data.status === 'OK') {
      return response.data.results.map(place => ({
        name: place.name,
        address: place.vicinity,
        location: place.geometry.location,
      }));
    }
    return [];
  } catch (error) { 
    console.error(`Error fetching ${type}:`, error.message);
    throw new Error('Failed to fetch data from Google Maps API.');
  }
}

router.get('/fireStations', async (req, res) => {
    const {guatemalaCityLocation, searchRadius} = req.query;
    try {
        const fireStations = await fetchNearbyPlaces('fire_station', guatemalaCityLocation, searchRadius, googleMapsApiKey);
        res.json(fireStations);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/policeStations', async (req, res) => {
    const {guatemalaCityLocation, searchRadius} = req.query;
    try {
        const policeStations = await fetchNearbyPlaces('police', guatemalaCityLocation, searchRadius, googleMapsApiKey);
        res.json(policeStations);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/', async (req, res) => {
    const {guatemalaCityLocation, searchRadius} = req.query;
    try {
        const [fireStations, policeStations] = await Promise.all([
            fetchNearbyPlaces('fire_station', guatemalaCityLocation, searchRadius, googleMapsApiKey),
            fetchNearbyPlaces('police', guatemalaCityLocation, searchRadius, googleMapsApiKey),
        ]);

        res.json({
            fire_stations: fireStations,
            police_stations: policeStations,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router