require("dotenv").config();
const express = require("express");

const stationsRoutes = require("./routes/stations");
const userRoutes = require("./routes/users");
const alertRoutes = require("./routes/alerts");
const memberRoutes = require("./routes/members");
const chatRoutes = require("./routes/chats");
const messageRoutes = require("./routes/messages");
const reportRoutes = require("./routes/reports");

const app = express();
app.use(express.json());
app.use("/stations", stationsRoutes);
app.use("/users", userRoutes);
app.use("/alerts", alertRoutes);
app.use("/members", memberRoutes);
app.use("/chats", chatRoutes);
app.use("/messages", messageRoutes);
app.use("/reports", reportRoutes);

const port = process.env.PORT || 8080;

app.listen(port, () => {
  console.log(`Servidor corriendo en el puerto ${port}`);
});
