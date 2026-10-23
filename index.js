require("dotenv").config();
const express = require("express");
const http = require("node:http");

const stationsRoutes = require("./routes/stations");
const userRoutes = require("./routes/users");
const alertRoutes = require("./routes/alerts");
const memberRoutes = require("./routes/members");
const chatRoutes = require("./routes/chats");
const messageRoutes = require("./routes/messages");
const reportRoutes = require("./routes/reports");
const detectionRoutes = require("./routes/detection");
const newsRoutes = require("./routes/news");

const app = express();
app.use(express.json());
// Public read endpoints used by the browser dashboard. Keep other routes intact.
app.use((req, res, next) => {
  if (!/^\/(?:news\/getNews|detection\/predictions)\/?$/.test(req.path) ||
      !["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const allowed = (process.env.DASHBOARD_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean);
  const origin = req.headers.origin;
  if (allowed.length) {
    res.vary("Origin");
    if (origin && !allowed.includes(origin)) return res.status(403).json({ error: "Origen no permitido." });
    if (origin) res.set("Access-Control-Allow-Origin", origin);
  } else res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});
app.use("/stations", stationsRoutes);
app.use("/users", userRoutes);
app.use("/alerts", alertRoutes);
app.use("/members", memberRoutes);
app.use("/chats", chatRoutes);
app.use("/messages", messageRoutes);
app.use("/reports", reportRoutes);
app.use("/detection", detectionRoutes)
app.use("/news", newsRoutes)

const port = process.env.PORT || 8080;

const server = http.createServer(app);
alertRoutes.attachWebSocketServer(server);

// Each service handles only its own path. Reject unknown Upgrade requests.
server.on("upgrade", (req, socket) => {
  let pathname;
  try { pathname = new URL(req.url, "http://localhost").pathname; }
  catch { socket.destroy(); return; }
  if (!/^\/alerts\/(stream|tracking\/(publish|watch))\/?$/.test(pathname)) {
    socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
  }
});

server.listen(port, () => {
  console.log(`Servidor corriendo en el puerto ${port}`);
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  alertRoutes.closeRealtime();
  server.close(() => process.exit(0));
  // Cloud Run allows a short grace period after SIGTERM.
  setTimeout(() => process.exit(0), 9000).unref();
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);


