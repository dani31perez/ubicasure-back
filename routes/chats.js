const express = require("express");
const router = express.Router();
const { Firestore } = require("@google-cloud/firestore");
const db = new Firestore();
const messageRef = db.collection("messages");
const chatRef = db.collection("chats");

/*
  POST /
  Crea un nuevo chat entre dos usuarios.
*/
router.post("/", async (req, res) => {
  const { sender, receiver } = req.body;

  if (!sender || !receiver)
    return res.status(400).send("All fields (sender, receiver) are required.");

  const chatData = { users: [sender, receiver] };
  await chatRef.add(chatData);

  res.status(201).json(chatData);
});

/*
  GET /getByUsername/:username
  Devuelve todos los chats en los que participa un usuario.
*/
router.get("/getByUsername/:username", async (req, res) => {
  const username = req.params.username;

  try {
    const chatQuery = chatRef.where("users", "array-contains", username);
    const chatDoc = await chatQuery.get();

    if (chatDoc.empty) {
      return res.status(404).send("Chat not found");
    }

    const chats = chatDoc.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.status(200).json(chats);
  } catch (err) {
    res.status(500).send("Error getting chat");
  }
});

/*
  DELETE /:chatId
  Elimina un chat por su ID, junto con todos sus mensajes asociados.
*/
router.delete("/:chatId", async (req, res) => {
  const { chatId } = req.params;

  try {
    const chatDocRef = chatRef.doc(chatId);
    const chatDocSnap = await chatDocRef.get();

    if (!chatDocSnap.exists) {
      return res.status(404).send("Chat not found");
    }

    const messages = messageRef.where("chatId", "==", chatId);
    const messagesSnapshot = await messages.get();

    const deletePromises = messagesSnapshot.docs.map((docSnap) =>
      messageRef.doc(docSnap.id).delete()
    );

    await Promise.all(deletePromises);

    await chatDocRef.delete();

    res.status(200).send("Chat and its messages deleted successfully");
  } catch (error) {
    console.error("Error deleting chat:", error);
    res.status(500).send("Error deleting chat and messages");
  }
});

/*
  GET /getByBothUsers/:user1/:user2
  Devuelve un chat específico entre dos usuarios (si existe).
*/
router.get("/getByBothUsers/:user1/:user2", async (req, res) => {
  const { user1, user2 } = req.params;

  try {
    const q = chatRef.where("users", "array-contains", user1);
    const querySnapshot = await q.get();

    const chat = querySnapshot.docs.find((doc) =>
      doc.data().users.includes(user2)
    );

    if (!chat) {
      return res.status(404).send("Chat not found");
    }

    res.status(200).json({ id: chat.id, ...chat.data() });
  } catch (err) {
    res.status(500).send("Error getting chat");
  }
});

module.exports = router;
