const { Storage } = require("@google-cloud/storage");
const storage = new Storage();
const bucketName = "ubicasure-chat-media";
const { getMessaging } = require("firebase-admin/messaging");
const bucket = storage.bucket(bucketName);
const { fetchNearbyPlaces, fetchPlaceDetails } = require("./places");

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
    const response = await getMessaging().sendEachForMulticast(message);

    return response;
  } catch (error) {
    console.error("Error enviando notificaciones FCM:", error);
    throw error;
  }
}

module.exports = { deleteFile, addFiles, detectIncident, fetchNearbyPlaces, fetchPlaceDetails, sendPushNotifications };
