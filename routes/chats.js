const express = require("express");
const router = express.Router();
const { Firestore } = require("@google-cloud/firestore");
const { poolPromise } = require("../config/dbConfig");
const db = new Firestore();
const messageRef = db.collection("messages");
const chatRef = db.collection("chats");

// Older chats store the station name as the second participant.
async function filterByStation(docs, stationId) {
  if (stationId === undefined) return docs;
  const id = Number(stationId);
  const legacyNames = [...new Set(docs.filter(doc => doc.data().stationId == null)
    .map(doc => doc.data().users[1]).filter(name => typeof name === "string"))];
  let matchingNames = [];
  if (legacyNames.length) {
    const pool = await poolPromise;
    const [rows] = await pool.query(`
      SELECT name FROM Stations WHERE name IN (?)
      GROUP BY name HAVING COUNT(*) = 1 AND MIN(stationId) = ?
    `, [legacyNames, id]);
    matchingNames = rows.map(row => row.name);
  }
  return docs.filter(doc => {
    const chat = doc.data();
    return chat.stationId === id || (chat.stationId == null && matchingNames.includes(chat.users[1]));
  });
}

router.use((req, res, next) => {
  const id = req.query.stationId ?? req.body?.stationId;
  if (id != null && (!(typeof id === "string" || typeof id === "number") ||
      !/^[1-9]\d*$/.test(String(id)) || Number(id) > 4294967295)) {
    return res.status(400).json({ error: "stationId inválido." });
  }
  next();
});

/*
  POST /
  Crea un nuevo chat entre dos usuarios.
*/
router.post("/", async (req, res) => {
  const { sender, senderName, receiver, stationId } = req.body;
  if (typeof sender !== "string" || !sender.trim()) {
    return res.status(400).json({ error: "Falta el remitente." });
  }

  const pool = await poolPromise;
  let stations;
  if (stationId != null) {
    [stations] = await pool.execute("SELECT stationId, name FROM Stations WHERE stationId = ?", [stationId]);
  } else {
    if (typeof receiver !== "string" || !receiver.trim()) {
      return res.status(400).json({ error: "Falta stationId." });
    }
    [stations] = await pool.execute("SELECT stationId, name FROM Stations WHERE name = ? LIMIT 2", [receiver]);
    if (stations.length > 1) return res.status(409).json({ error: "Selecciona la estación por stationId." });
  }
  if (!stations.length) return res.status(404).json({ error: "Estación sin registrar." });

  const station = stations[0];
  const chatData = { users: [sender, station.name], stationId: station.stationId, lastMessage: null };
  if (typeof senderName === "string" && senderName.trim() && senderName.trim() !== sender) {
    chatData.userName = senderName.trim();
  }
  const chat = await chatRef.add(chatData);
  res.status(201).json({ id: chat.id, ...chatData });
});

/*
  GET /getByUsername/:username
  Devuelve todos los chats en los que participa un usuario.
*/
router.get("/getByUsername/:username", async (req, res) => {
  const username = req.params.username;

  try {
    const stationId = req.query.stationId;
    const chatQuery = chatRef.where("users", "array-contains", username);
    const chatDoc = await chatQuery.get();
    const docs = await filterByStation(chatDoc.docs, stationId);
    if (!docs.length) {
      return res.status(404).send("Chat not found");
    }

    const chats = docs.map((doc) => ({
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

    const candidates = querySnapshot.docs.filter(doc => doc.data().users.includes(user2));
    const [chat] = await filterByStation(candidates, req.query.stationId);

    if (!chat) {
      return res.status(404).send("Chat not found");
    }

    res.status(200).json({ id: chat.id, ...chat.data() });
  } catch (err) {
    res.status(500).send("Error getting chat");
  }
});

module.exports = router;
