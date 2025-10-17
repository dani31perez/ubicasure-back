require('dotenv').config();
const express = require("express");
const admin = require("firebase-admin");

const serviceAccountString = process.env.FIREBASE_SERVICE_ACCOUNT;
const serviceAccount = JSON.parse(serviceAccountString);
const stationsRoutes = require("./routes/stations");
const userRoutes  = require("./routes/users");
const alertRoutes = require("./routes/alerts");
const memberRoutes = require("./routes/members")

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
 
const app = express();
app.use(express.json());
app.use("/stations", stationsRoutes);
app.use("/users", userRoutes);
app.use("/alerts", alertRoutes);
app.use("/members", memberRoutes);


const port = process.env.PORT || 8080;

app.listen(port, () => {
  console.log(`Servidor corriendo en el puerto ${port}`);
});