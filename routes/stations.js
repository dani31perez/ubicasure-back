const express = require("express");
const router = express.Router();
const { fetchNearbyPlaces, fetchPlaceDetails, parseSearch } = require("../utils/places");

const { poolPromise } = require("../config/dbConfig");
const { authenticateMember } = require("../middleware/jwt");
const requireRole = require("../middleware/requireRole");

function isClosedRing(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return false;
  for (const point of ring) {
    if (!Array.isArray(point) || point.length !== 2) return false;
    const [lon, lat] = point;
    if (!Number.isFinite(lon) || lon <= -180 || lon > 180 ||
        !Number.isFinite(lat) || lat < -90 || lat > 90) return false;
  }
  const last = ring[ring.length - 1];
  return ring[0][0] === last[0] && ring[0][1] === last[1];
}

function isCoveragePolygon(coverage) {
  return coverage?.type === "Polygon" && Array.isArray(coverage.coordinates) &&
    coverage.coordinates.length > 0 && coverage.coordinates.every(ring =>
      isClosedRing(ring) && new Set(ring.slice(0, -1).map(point => JSON.stringify(point))).size >= 3
    ) && coverage.coordinates.reduce((total, ring) => total + ring.length - 1, 0) <= 500;
}

function coverageError(error, res) {
  if (["ER_GIS_INVALID_DATA", "ER_INVALID_GEOJSON_UNSPECIFIED", "ER_INVALID_GEOJSON_WRONG_DIMENSION",
    "ER_GEOMETRY_PARAM_LONGITUDE_OUT_OF_RANGE", "ER_GEOMETRY_PARAM_LATITUDE_OUT_OF_RANGE"].includes(error.code)) {
    return res.status(400).json({ error: "El polígono de cobertura es inválido." });
  }
  return res.status(500).json({ error: "No fue posible actualizar la cobertura de la estación." });
}

// authenticateMember comprueba que el ID de la ruta coincida con la estación del token.
router.get("/:stationId/coverage", authenticateMember, async (req, res) => {
  try {
    const pool = await poolPromise;
    const [rows] = await pool.execute(`
      SELECT stationId, name, googlePlaceId AS placeId, ST_AsGeoJSON(coverage) AS coverage
      FROM Stations WHERE stationId = ?
    `, [req.member.stationId]);
    if (!rows.length) return res.status(404).json({ error: "Estación no encontrada." });
    const row = rows[0];
    const coverage = typeof row.coverage === "string" ? JSON.parse(row.coverage) : row.coverage;
    return res.json({ stationId: row.stationId, name: row.name, placeId: row.placeId, coverage: coverage ?? null });
  } catch {
    return res.status(500).json({ error: "No fue posible consultar la cobertura de la estación." });
  }
});

router.put("/:stationId/coverage", authenticateMember, requireRole("Jefe de Estacion"), async (req, res) => {
  const { coverage } = req.body || {};
  if (!isCoveragePolygon(coverage)) {
    return res.status(400).json({ error: "Envía coverage como un Polygon GeoJSON con al menos tres puntos distintos, anillos cerrados y un máximo de 500 vértices, en orden [longitud, latitud]." });
  }
  try {
    const pool = await poolPromise;
    const polygon = JSON.stringify({ type: "Polygon", coordinates: coverage.coordinates });
    const [validity] = await pool.execute(
      "SELECT ST_IsValid(ST_GeomFromGeoJSON(?, 1, 4326)) AS valid", [polygon]
    );
    if (!Number(validity[0]?.valid)) {
      return res.status(400).json({ error: "El polígono de cobertura es inválido. Revisa que sus bordes no se crucen." });
    }
    const [result] = await pool.execute(
      "UPDATE Stations SET coverage = ST_GeomFromGeoJSON(?, 1, 4326) WHERE stationId = ?",
      [polygon, req.member.stationId]
    );
    // Un UPDATE sin cambios puede devolver affectedRows = 0. Guardarlo otra vez también es válido.
    if (!result.affectedRows) {
      const [existing] = await pool.execute("SELECT stationId FROM Stations WHERE stationId = ?", [req.member.stationId]);
      if (!existing.length) return res.status(404).json({ error: "Estación no encontrada." });
    }
    return res.json({ stationId: req.member.stationId, coverage: JSON.parse(polygon), message: "Cobertura actualizada." });
  } catch (error) {
    return coverageError(error, res);
  }
});

router.post("/", authenticateMember, requireRole("Jefe de Estacion"), async (req, res) => {
  const { name, placeId, coverage } = req.body || {};
  if (typeof name !== "string" || !name.trim() || [...name.trim()].length > 100 ||
      typeof placeId !== "string" || !/^[!-~]{1,512}$/.test(placeId)) {
    return res.status(400).json({ error: "Envía el nombre de la estación y el placeId del marcador." });
  }
  if (coverage?.type !== "Polygon" || !Array.isArray(coverage.coordinates) ||
      !coverage.coordinates.length || !coverage.coordinates.every(isClosedRing)) {
    return res.status(400).json({ error: "Envía coverage como un Polygon GeoJSON con anillos cerrados en orden [longitud, latitud]." });
  }
  try {
    const pool = await poolPromise;
    const polygon = JSON.stringify({ type: "Polygon", coordinates: coverage.coordinates });
    const [result] = await pool.execute(`
      INSERT INTO Stations (name, googlePlaceId, coverage)
      SELECT ?, ?, p.geom FROM (SELECT ST_GeomFromGeoJSON(?, 1, 4326) AS geom) AS p
      WHERE ST_IsValid(p.geom)
    `, [name.trim(), placeId, polygon]);
    if (!result.affectedRows) return res.status(400).json({ error: "El polígono de cobertura es inválido." });
    res.status(201).json({ stationId: result.insertId, name: name.trim(), placeId });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "La estación ya está registrada." });
    if (error.code === "ER_GIS_INVALID_DATA") return res.status(400).json({ error: "El polígono de cobertura es inválido." });
    res.status(500).json({ error: "No fue posible registrar la estación." });
  }
});

router.get("/byPlace/:placeId", async (req, res) => {
  const { placeId } = req.params;
  if (typeof placeId !== "string" || !placeId.trim() || placeId.length > 512) {
    return res.status(400).json({ error: "Envía el placeId del marcador." });
  }
  const pool = await poolPromise;
  const [rows] = await pool.execute(
    "SELECT stationId FROM Stations WHERE googlePlaceId = ?", [placeId]
  );
  const stationId = rows[0]?.stationId ?? null;
  res.json({ stationId, canStartChat: stationId !== null });
});

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
