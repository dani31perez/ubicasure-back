const express = require("express");
const router = express.Router();
const multer = require("multer");
const { Firestore } = require("@google-cloud/firestore");
const db = new Firestore();
const messageRef = db.collection("messages");
const upload = multer({ storage: multer.memoryStorage() });
const { addFiles } = require("../utils/utils.js");

/*
  POST /
  Agrega un nuevo mensaje a un chat específico.
*/
router.post("/", upload.single("data"), async (req, res) => {
  const { chatId, sender, type, position } = req.body;
  const senderName = typeof req.body.senderName === "string" ? req.body.senderName.trim() : "";

  // Validar campos obligatorios
  if (!sender || !chatId || !type || !position || !senderName)
    return res
      .status(400)
      .send("All fields (sender, data, chatId, type, position, senderName) are required.");

  try {
    // Verificar que el chat exista
    const chatRef = db.collection("chats").doc(chatId);
    const chatDoc = await chatRef.get();
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
      senderName
    };

    const saved = await db.runTransaction(async transaction => {
      const current = await transaction.get(chatRef);
      if (!current.exists) return null;
      const chat = current.data();
      let sequence = 0;
      if (Number.isSafeInteger(chat.lastMessage?.sequence)) {
        sequence = chat.lastMessage.sequence + 1;
      } else if (chat.lastMessage !== null) {
        // Los chats antiguos ya tienen mensajes con IDs de la forma chatId_n.
        const history = await transaction.get(messageRef.where("chatId", "==", chatId).select());
        for (const doc of history.docs) {
          const suffix = doc.id.slice(chatId.length + 1);
          if (doc.id.startsWith(chatId + "_") && /^\d+$/.test(suffix)) {
            sequence = Math.max(sequence, Number(suffix) + 1);
          }
        }
      }
      const ref = messageRef.doc(`${chatId}_${sequence}`);
      const fromUser = sender === chat.users?.[0];
      const name = fromUser && senderName === sender && chat.userName ? chat.userName : senderName;
      const lastMessage = { id: ref.id, sequence, sender, senderName: name, type, timestamp,
        data: type === "Imagen" ? "Imagen" : messageContent };
      const updates = { lastMessage };
      if (fromUser && name !== sender) updates.userName = name;
      const message = { ...messageData, senderName: name };
      transaction.create(ref, message);
      transaction.update(chatRef, updates);
      return { id: ref.id, ...message };
    });
    if (!saved) return res.status(404).send("Chat not found.");
    res.status(201).json(saved);
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
