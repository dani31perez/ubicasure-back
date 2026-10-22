const { WebSocket, WebSocketServer } = require("ws");

// MySQL remains the source of truth. Each instance sends local changes at once
// and reconciles changes made by other Cloud Run instances while it has clients.
function createAlertStream({ loadActiveAlerts, syncIntervalMs = 3000, logger = console }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
  const states = new Map();
  let server;
  let timer;
  let running;
  let requested = 0;
  let stopped = false;
  let lastHeartbeat = Date.now();

  function send(socket, message) {
    if (socket.readyState !== WebSocket.OPEN) return false;
    // Disconnect slow clients. A reconnect receives a fresh authoritative snapshot.
    if (socket.bufferedAmount > 4 * 1024 * 1024) {
      socket.terminate();
      return false;
    }
    socket.send(JSON.stringify({ ...message, serverTime: new Date().toISOString() }), error => {
      if (error) socket.terminate();
    });
    return true;
  }

  function publish(rows) {
    const current = new Map(rows.map(alert => [String(alert.alertId), alert]));
    const signatures = new Map([...current].map(([id, alert]) => [id, JSON.stringify(alert)]));
    for (const [socket, previous] of states) {
      if (previous === null) {
        if (send(socket, { type: "alerts.snapshot", alerts: [...current.values()] })) states.set(socket, signatures);
        continue;
      }
      const removed = [...previous.keys()].filter(id => !current.has(id));
      if (removed.length) send(socket, { type: "alerts.removed", alertIds: removed });
      for (const [id, alert] of current) {
        if (previous.get(id) !== signatures.get(id)) send(socket, { type: "alerts.upsert", alert });
      }
      states.set(socket, signatures);
    }
  }

  function refresh() {
    if (stopped || states.size === 0) return Promise.resolve();
    requested += 1;
    if (running) return running;
    running = (async () => {
      let version;
      do {
        version = requested;
        const rows = await loadActiveAlerts();
        if (!stopped) publish(rows);
      } while (!stopped && version !== requested && states.size > 0);
    })().catch(error => {
      logger.error("No se pudo sincronizar el socket de alertas:", error.message);
      // Never replace the client's data with an empty list after a DB failure.
      for (const socket of states.keys()) {
        send(socket, { type: "alerts.error", message: "No fue posible sincronizar las alertas." });
        socket.close(1011, "No fue posible sincronizar las alertas");
      }
    }).finally(() => { running = null; });
    return running;
  }

  function startTimer() {
    if (timer) return;
    timer = setInterval(() => {
      const now = Date.now();
      if (now - lastHeartbeat >= 25000) {
        lastHeartbeat = now;
        for (const socket of states.keys()) {
          if (!socket.isAlive) { socket.terminate(); continue; }
          socket.isAlive = false;
          socket.ping();
          send(socket, { type: "alerts.heartbeat" });
        }
      }
      // A slow query must finish before the periodic timer schedules another.
      // Explicit writes and new connections still request a follow-up pass.
      if (!running) void refresh();
    }, syncIntervalMs);
    timer.unref();
  }

  wss.on("connection", socket => {
    states.set(socket, null);
    socket.isAlive = true;
    socket.on("pong", () => { socket.isAlive = true; });
    socket.on("error", error => logger.error("Error en socket de alertas:", error.message));
    socket.on("close", () => {
      states.delete(socket);
      if (states.size === 0) { clearInterval(timer); timer = null; }
    });
    startTimer();
    void refresh();
  });

  function upgrade(req, socket, head) {
    let pathname;
    try { pathname = new URL(req.url, "http://localhost").pathname; }
    catch { socket.destroy(); return; }
    if (pathname !== "/alerts/stream" && pathname !== "/alerts/stream/") {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }
    const allowedOrigins = (process.env.DASHBOARD_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean);
    if (req.headers.origin && allowedOrigins.length && !allowedOrigins.includes(req.headers.origin)) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, client => wss.emit("connection", client, req));
  }

  return {
    refresh,
    attach(httpServer) {
      if (server) throw new Error("El socket de alertas ya está conectado al servidor HTTP.");
      server = httpServer;
      server.on("upgrade", upgrade);
      server.once("close", () => this.close());
    },
    close() {
      stopped = true;
      clearInterval(timer);
      server?.removeListener("upgrade", upgrade);
      for (const socket of states.keys()) socket.terminate();
      states.clear();
      wss.close();
    },
  };
}

module.exports = { createAlertStream };
