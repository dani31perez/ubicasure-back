const express = require("express");
const admin = require("firebase-admin");

const serviceAccount = require("./serviceAccountKey.json");
const stationsRoutes = require("./routes/stations");
const userRoutes  = require("./routes/users");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const app = express();
app.use(express.json());
app.use("/stations", stationsRoutes);
app.use("/users", userRoutes);

app.listen(8080, () => console.log("Servidor corriendo en http://localhost:8080"));
