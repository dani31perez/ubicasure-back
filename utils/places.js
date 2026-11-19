const axios = require("axios");

function placesError(error) {
  const messages = {
    REQUEST_DENIED: "Google denegó el acceso. Revisa la clave, sus restricciones y Places API en tu proyecto.",
    INVALID_REQUEST: "Google rechazó los parámetros de la consulta de Places.",
    OVER_QUERY_LIMIT: "Se alcanzó una cuota de Google Places.",
    OVER_DAILY_LIMIT: "Revisa la cuota diaria y la facturación del proyecto de Google Places.",
    NOT_FOUND: "Google no encontró ese lugar.",
    ZERO_RESULTS: "Google no encontró ese lugar.",
    UNKNOWN_ERROR: "Google Places tuvo un error temporal.",
  };
  const status = error.response?.status;
  const code = error.response?.data?.status;
  const reason = Object.hasOwn(messages, code) ? code : status === 403 ? "REQUEST_DENIED" :
    status === 404 ? "NOT_FOUND" : status === 429 ? "OVER_QUERY_LIMIT" : "UPSTREAM_ERROR";
  const failure = new Error(messages[reason] || "No fue posible consultar Google Places.");
  failure.reason = error.code === "ECONNABORTED" ? "TIMEOUT" : reason;
  failure.googleStatus = status;
  failure.status = ["NOT_FOUND", "ZERO_RESULTS"].includes(reason) ? 404 :
    error.code === "ECONNABORTED" ? 504 : 502;
  return failure;
}

function placesData(response, allowEmpty = false) {
  if (response.data.status === "OK" || (allowEmpty && response.data.status === "ZERO_RESULTS")) {
    return response.data;
  }
  throw placesError({ response });
}

function parseSearch(location, radius) {
  if (typeof location !== "string" || !/^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(location.trim())) {
    const error = new Error("guatemalaCityLocation debe tener el formato latitud,longitud.");
    error.status = 400;
    throw error;
  }
  const [latitude, longitude] = location.split(",").map(Number);
  const distance = Number(radius);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180 ||
      radius == null || String(radius).trim() === "" || !Number.isFinite(distance) || distance <= 0 || distance > 50000) {
    const error = new Error("Coordenadas inválidas. searchRadius debe ser mayor que 0 y hasta 50000 metros.");
    error.status = 400;
    throw error;
  }
  return { latitude, longitude, radius: distance };
}

async function fetchNearbyPlaces(type, location, radius, apiKey) {
  const circle = parseSearch(location, radius);
  let response;
  try {
    response = await axios.get("https://maps.googleapis.com/maps/api/place/nearbysearch/json", {
      params: { location: `${circle.latitude},${circle.longitude}`, radius: circle.radius, type, key: apiKey, language: "es" },
      timeout: 15000,
    });
  } catch (error) { throw placesError(error); }
  const data = placesData(response, true);
  return (data.results || []).map(place => ({
    place_id: place.place_id,
    name: place.name || null,
    geometry: place.geometry,
  }));
}

async function fetchPlaceDetails(placeId, apiKey) {
  let response;
  try {
    response = await axios.get("https://maps.googleapis.com/maps/api/place/details/json", {
      params: {
        place_id: placeId, key: apiKey, language: "es",
        fields: "place_id,name,type,vicinity,formatted_address,geometry,formatted_phone_number,international_phone_number,opening_hours,current_opening_hours,website,url,business_status",
      },
      timeout: 15000,
    });
  } catch (error) { throw placesError(error); }
  const data = placesData(response);
  const place = data.result;
  return {
    ...place,
    vicinity: place.formatted_address || place.vicinity || null,
    open_now: place.current_opening_hours?.open_now ?? place.opening_hours?.open_now ?? null,
    maps_url: place.url || null,
    attributions: data.html_attributions || [],
  };
}

module.exports = { fetchNearbyPlaces, fetchPlaceDetails, parseSearch };
