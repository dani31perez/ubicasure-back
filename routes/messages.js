const express = require("express");
const router = express.Router();
const multer = require("multer");
const { Firestore } = require("@google-cloud/firestore");
const db = new Firestore();
const messageRef = db.collection("messages");
const upload = multer({ storage: multer.memoryStorage() });
const { deleteFile, addFiles } = require("../utils.js");

/*
  POST /
  Agrega un nuevo mensaje a un chat específico.
*/
router.post("/", upload.single("data"), async (req, res) => {
  const { chatId, sender, type, position } = req.body;

  // Validar campos obligatorios
  if (!sender || !chatId || !type || !position)
    return res
      .status(400)
      .send("All fields (sender, data, chatId, type, position) are required.");

  try {
    // Verificar que el chat exista
    const chatDoc = await db.collection("chats").doc(chatId).get();
    if (!chatDoc.exists) {
      return res.status(404).send("Chat not found.");
    }

    let messageContent;

    if (type === "Imagen") {
      if (!req.file) {
        return res
          .status(400)
          .send("An image file is required for type 'Imagen'.");
      }

      const imageUrlArray = await addFiles([req.file], "chat_images", sender);
      messageContent = imageUrlArray[0];
    } else {
      if (!req.body.data) {
        return res
          .status(400)
          .send("The 'data' field is required for non-image types.");
      }
      messageContent = req.body.data;
    }

    // Calcular el ID personalizado basado en la cantidad de mensajes
    const messagesQuery = messageRef.where("chatId", "==", chatId);
    const querySnapshot = await messagesQuery.get();
    const count = querySnapshot.size;
    const customId = `${chatId}_${count}`;

    // Obtener la fecha y hora actual en formato local
    const timestamp = new Date().toLocaleString("es-GT", {
      timeZone: "America/Guatemala",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });

    // Crear objeto de mensaje
    const messageData = {
      sender,
      data: messageContent,
      chatId,
      timestamp,
      type,
      position,
    };

    // Guardar el mensaje con ID personalizado
    await messageRef.doc(customId).set(messageData);
    res.status(201).json({ id: customId, ...messageData });
  } catch (err) {
    console.error("Error adding message:", err);
    res.status(500).send("Error adding message");
  }
});

/*
  GET /getByChat/:chatId
  Obtiene todos los mensajes de un chat específico.
*/
router.get("/getByChat/:chatId", async (req, res) => {
  const { chatId } = req.params;

  try {
    const messagesQuery = messageRef.where("chatId", "==", chatId);
    const querySnapshot = await messagesQuery.get();

    const messages = querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.status(200).json(messages);
  } catch (error) {
    console.error("Error fetching messages by chatId:", error);
    res.status(500).send("Error fetching messages");
  }
});

module.exports = router;
