const { Storage } = require("@google-cloud/storage");
const storage = new Storage();
const bucketName = "ubicasure-chat-media";
const { getMessaging } = require("firebase-admin/messaging");
const bucket = storage.bucket(bucketName);
const axios = require("axios");
const { poolPromise } = require("./config/dbConfig");

/*
  Elimina un archivo de firebase storage, usando la ruta completa y la carpeta donde se encuentra.
*/
const deleteFile = async (filePath, storagePath) => {
  try {
    const fileName = decodeURIComponent(
      filePath.split(storagePath + "%2F")[1].split("?")[0]
    );

    const imageRef = `${storagePath}/${fileName}`;
    const file = bucket.file(imageRef);
    await file.delete();
  } catch (err) {
    throw new Error("Error deleting file from cloud storage");
  }
};

/*
  Sube una lista de archivos a firebase storage y devuelve sus URLs.
*/
const addFiles = async (files, storagePath, id) => {
  return await Promise.all(
    files.map(async (file) => {
      const username = id.replace(/"/g, "");
      const fileName = `${username}-${Date.now()}${file.originalname}`;
      const filePath = `${storagePath}/${fileName}`;
      const fileRef = bucket.file(filePath);
      await fileRef.save(file.buffer, {
        metadata: {
          contentType: file.mimetype,
        },
      });

      const [signedUrl] = await fileRef.getSignedUrl({
        action: "read",
        expires: "01-01-2030",
      });

      return signedUrl;
    })
  );
};

async function detectIncident(imageUrl) {
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
    const error = new Error("El servicio de análisis devolvió un error.");
    error.status = response.status;
    error.details = errorBody;
    throw error;
  }

  return response.json();
}

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

const getMembersByStation = async (station) => {
  const findQuery = "SELECT * FROM Members WHERE station = ?";
  const pool = await poolPromise;

  const [members] = await pool.execute(findQuery, [station]);

  return members.map(({ code, ...rest }) => rest);
};

async function sendPushNotifications(members, alertData) {
  const tokens = members
    .map(member => member.fcmToken)
    .filter(Boolean);

  if (tokens.length === 0) {
    console.log("No hay tokens FCM para enviar.");
    return;
  }

  const message = {
    notification: {
      title: "Alerta cercana",
      body: "Se ha detectado una alerta cerca de tu estación.",
    },

    data: {
      alertId: String(alertData.alertId),
      latitude: String(alertData.latitude),
      longitude: String(alertData.longitude),
    },

    tokens,
  };

  try {
    const response = await getMessaging().FidMulticastMessage(message);

    return response;
  } catch (error) {
    console.error("Error enviando notificaciones FCM:", error);
    throw error;
  }
}

module.exports = { deleteFile, addFiles, detectIncident, fetchNearbyPlaces, fetchPlaceDetails, sendPushNotifications, getMembersByStation };
