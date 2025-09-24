const express = require('express');
const router = express.Router();

router.post("/setAdmin", async (req, res) => {
  const { uid, rol } = req.body;
  try {
    await admin.auth().setCustomUserClaims(uid, { admin: rol });
    const user = await admin.auth().getUser(uid);
    console.log(user.customClaims);
    res.send({ message: "Rol asignado!" });
  } catch (e) {
    res.status(500).send({ error: e.message });
  }
}); 

module.exports = router;