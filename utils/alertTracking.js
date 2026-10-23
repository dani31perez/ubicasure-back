const { randomUUID } = require("node:crypto");
const { WebSocket, WebSocketServer } = require("ws");

class TrackingError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function fail(status, code, message) {
  throw new TrackingError(status, code, message);
}

function parseStations(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function sameEmail(a, b) {
  return typeof a === "string" && typeof b === "string" &&
    a.trim().toLowerCase() === b.trim().toLowerCase();
}

// Run the existing REST authentication on an HTTP Upgrade request as well.
function authenticate(request, middleware, field) {
  return new Promise((resolve, reject) => {
    let status = 401;
    const response = {
      status(value) { status = value; return this; },
      json() {
        reject(new TrackingError(status, "unauthorized", "Token ausente, inválido o expirado."));
        return this;
      },
    };
    Promise.resolve().then(() => middleware(request, response, () => {
      const identity = request[field];
      if (!identity?.email || !Number.isFinite(identity.exp)) {
        reject(new TrackingError(401, "unauthorized", "El token no contiene una identidad válida."));
        return;
      }
      resolve(identity);
    })).catch(reject);
  });
}

// Only this process owns these sessions. No coordinates are written to a DB.
function createAlertTracking({
  loadAlerts,
  loadMember,
  authenticateMember,
  authenticateUser,
  locationIntervalMs = 5000,
  locationTimeoutMs = 20000,
  checkIntervalMs = 5000,
  alertCheckIntervalMs = 15000,
  heartbeatIntervalMs = 15000,
  authTimeoutMs = 10000,
  maxStreams = 200,
  maxConnections = 500,
  now = Date.now,
  logger = console,
}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2048, perMessageDeflate: false });
  const sessions = new Map();
  const publishers = new Map();
  const connections = new Map();
  const pendingSockets = new Set();
  let server;
  let timer;
  let closed = false;
  let refreshing;
  let lastAlertCheck = 0;
  let lastHeartbeat = 0;

  const iso = value => new Date(value).toISOString();
  const publisherKey = (alertId, email) => JSON.stringify([alertId, email.trim().toLowerCase()]);

  function send(socket, payload) {
    if (socket.readyState !== WebSocket.OPEN) return false;
    if (socket.bufferedAmount > 64 * 1024) { socket.terminate(); return false; }
    try {
      socket.send(JSON.stringify({ ...payload, serverTime: iso(now()) }), error => {
        if (error) socket.terminate();
      });
      return true;
    } catch { socket.terminate(); return false; }
  }

  function closeSocket(socket, code, reason) {
    if (socket.readyState === WebSocket.CLOSED) return;
    socket.close(code, reason);
    const kill = setTimeout(() => socket.terminate(), 1000);
    kill.unref();
    socket.once("close", () => clearTimeout(kill));
  }

  function snapshot(session) {
    return {
      trackingId: session.id,
      alertId: session.alertId,
      station: session.station,
      memberName: session.memberName,
      status: session.location ? "sharing" : "waiting_location",
      location: session.location,
      startedAt: iso(session.startedAt),
      lastUpdateAt: session.location?.receivedAt ?? null,
    };
  }

  function endSession(session, reason = "publisher_disconnected") {
    if (sessions.get(session.id) !== session) return;
    sessions.delete(session.id);
    publishers.delete(session.key);
    const lost = ["publisher_disconnected", "location_timeout", "publisher_token_expired",
      "server_shutdown", "validation_unavailable"].includes(reason);
    const stopped = reason === "member_stopped";
    const status = lost ? "connection_lost" : stopped ? "stopped" : "ended";
    const event = {
      type: "tracking.status", trackingId: session.id, alertId: session.alertId,
      status, reason, location: null,
      message: lost ? "Conexión perdida." : stopped ? "El miembro dejó de compartir su ubicación." : "Seguimiento finalizado.",
    };
    // Erase the last location before closing. A disconnected point isn't live.
    session.location = null;
    for (const socket of [session.publisher, ...session.viewers]) {
      send(socket, event);
      closeSocket(socket, lost ? 4001 : 1000, reason);
    }
    session.viewers.clear();
  }

  function activeAlert(alert) {
    return Boolean(alert && Number(alert.trackingEligible) === 1);
  }

  async function getAlert(alertId) {
    const alerts = await loadAlerts([alertId]);
    const alert = alerts.find(value => String(value.alertId) === alertId);
    if (!alert) fail(404, "alert_not_found", "Alerta no encontrada.");
    if (!activeAlert(alert)) fail(409, "alert_inactive", "La alerta ya no está activa.");
    return alert;
  }

  async function authorizePublisher(alertId, identity) {
    const [alert, member] = await Promise.all([getAlert(alertId), loadMember(identity.email)]);
    if (!member || !member.station || member.station !== identity.station) {
      fail(403, "member_not_authorized", "El miembro ya no pertenece a la estación de su token.");
    }
    if (!parseStations(alert.attendingStations).includes(member.station)) {
      fail(403, "station_not_attending", "Tu estación debe atender esta alerta antes de compartir ubicación.");
    }
    return { alert, member };
  }

  function checkLiveness() {
    const time = now();
    for (const [socket, connection] of connections) {
      if (connection.identity.exp * 1000 <= time) {
        if (connection.role === "publisher") endSession(connection.session, "publisher_token_expired");
        else {
          send(socket, { type: "tracking.error", code: "token_expired", message: "Renueva tu token y vuelve a conectarte." });
          closeSocket(socket, 4003, "token_expired");
        }
      }
    }
    for (const session of sessions.values()) {
      if (session.publisher.readyState !== WebSocket.OPEN) endSession(session);
      else if (time - session.lastUpdateMs >= locationTimeoutMs) endSession(session, "location_timeout");
    }
    if (time - lastHeartbeat >= heartbeatIntervalMs) {
      lastHeartbeat = time;
      for (const [socket, connection] of connections) {
        if (socket.readyState !== WebSocket.OPEN) continue;
        if (!connection.alive) { socket.terminate(); continue; }
        connection.alive = false;
        socket.ping();
        send(socket, { type: "tracking.heartbeat" });
      }
    }
  }

  // Called periodically and before discovery. A DB outage fails closed.
  async function reconcile() {
    checkLiveness();
    if (closed || !sessions.size) return;
    if (refreshing) return refreshing;
    const batch = [...sessions.values()];
    refreshing = (async () => {
      try {
        const alerts = await loadAlerts([...new Set(batch.map(session => session.alertId))]);
        const byId = new Map(alerts.map(alert => [String(alert.alertId), alert]));
        for (const session of batch) {
          const alert = byId.get(session.alertId);
          if (!activeAlert(alert)) endSession(session, "alert_inactive");
          else if (!sameEmail(alert.email, session.userEmail) ||
              !parseStations(alert.attendingStations).includes(session.station)) {
            endSession(session, "authorization_changed");
          }
        }
        lastAlertCheck = now();
      } catch (error) {
        logger.error("No se pudo validar el seguimiento de alertas:", error.message);
        for (const session of sessions.values()) endSession(session, "validation_unavailable");
        throw new TrackingError(503, "validation_unavailable", "No fue posible validar las alertas. Intenta nuevamente.");
      }
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  function startTimer() {
    if (timer) return;
    lastHeartbeat = now();
    timer = setInterval(() => {
      checkLiveness();
      if (sessions.size && !refreshing && now() - lastAlertCheck >= alertCheckIntervalMs) {
        void reconcile().catch(() => {});
      }
    }, checkIntervalMs);
    timer.unref();
  }

  function handleMessage(socket, raw, binary) {
    checkLiveness();
    const connection = connections.get(socket);
    if (!connection || socket.readyState !== WebSocket.OPEN) return;
    if (connection.identity.exp * 1000 <= now()) { checkLiveness(); return; }
    const bucket = Math.floor(now() / 1000);
    if (connection.bucket !== bucket) { connection.bucket = bucket; connection.messages = 0; }
    if (++connection.messages > 20) { closeSocket(socket, 1008, "rate_limited"); return; }
    try {
      if (binary) fail(400, "invalid_message", "Envía mensajes JSON de texto.");
      let message;
      try { message = JSON.parse(raw.toString()); }
      catch { fail(400, "invalid_json", "El mensaje debe contener JSON válido."); }
      if (!message || typeof message !== "object" || Array.isArray(message)) {
        fail(400, "invalid_message", "El mensaje debe ser un objeto JSON.");
      }
      if (message.type === "ping") { send(socket, { type: "pong" }); return; }
      if (connection.role !== "publisher") fail(403, "read_only", "Esta conexión solo permite ver la ubicación.");
      const session = connection.session;
      if (sessions.get(session.id) !== session) return;
      if (message.type === "tracking.stop") { endSession(session, "member_stopped"); return; }
      if (message.type !== "location.update") fail(400, "invalid_type", "Tipo de mensaje no reconocido.");
      const { latitude, longitude, sequence, capturedAt, accuracyMeters } = message;
      if (typeof latitude !== "number" || !Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
          typeof longitude !== "number" || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
        fail(400, "invalid_coordinates", "Latitud o longitud inválida.");
      }
      if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence <= session.sequence) {
        fail(400, "invalid_sequence", "La secuencia debe aumentar en cada actualización.");
      }
      const capturedMs = typeof capturedAt === "string" ? Date.parse(capturedAt) : NaN;
      if (!Number.isFinite(capturedMs) || Math.abs(now() - capturedMs) > 60000 || capturedMs < session.capturedMs) {
        fail(400, "invalid_timestamp", "La ubicación debe ser reciente y no retroceder en el tiempo.");
      }
      if (accuracyMeters != null && (typeof accuracyMeters !== "number" ||
          !Number.isFinite(accuracyMeters) || accuracyMeters < 0 || accuracyMeters > 100000)) {
        fail(400, "invalid_accuracy", "La precisión debe expresarse en metros positivos.");
      }
      if (session.location && now() - session.lastUpdateMs < 1000) {
        fail(429, "rate_limited", "Espera al menos un segundo entre coordenadas. Se recomiendan cinco.");
      }
      session.sequence = sequence;
      session.capturedMs = capturedMs;
      session.lastUpdateMs = now();
      session.location = {
        latitude, longitude, accuracyMeters: accuracyMeters ?? null,
        sequence, capturedAt: iso(capturedMs), receivedAt: iso(session.lastUpdateMs),
      };
      const update = { type: "tracking.location", ...snapshot(session) };
      for (const viewer of session.viewers) send(viewer, update);
      send(socket, { type: "location.ack", trackingId: session.id, sequence, receivedAt: session.location.receivedAt });
    } catch (error) {
      send(socket, {
        type: "tracking.error", code: error.code || "invalid_message",
        message: error instanceof TrackingError ? error.message : "Mensaje inválido.",
      });
    }
  }

  function connected(socket, context) {
    socket.on("error", () => socket.terminate());
    const { role, identity } = context;
    let session;
    if (role === "publisher") {
      const { alert, member } = context;
      const key = publisherKey(String(alert.alertId), identity.email);
      // Recheck after the async authorization and HTTP upgrade to prevent races.
      if (publishers.has(key) || sessions.size >= maxStreams || connections.size >= maxConnections) {
        closeSocket(socket, 4009, "publisher_conflict_or_capacity");
        return;
      }
      session = {
        id: randomUUID(), key, alertId: String(alert.alertId), userEmail: alert.email,
        memberEmail: identity.email, memberName: member.fullName || "Miembro de estación",
        station: member.station, publisher: socket, viewers: new Set(),
        startedAt: now(), lastUpdateMs: now(), sequence: -1, capturedMs: -Infinity, location: null,
      };
      sessions.set(session.id, session);
      publishers.set(key, session);
    } else {
      session = sessions.get(context.trackingId);
      if (!session || connections.size >= maxConnections) {
        closeSocket(socket, 4001, "tracking_unavailable");
        return;
      }
      session.viewers.add(socket);
    }
    connections.set(socket, { role, identity, session, alive: true, messages: 0 });
    socket.on("pong", () => { const connection = connections.get(socket); if (connection) connection.alive = true; });
    socket.on("message", (raw, binary) => handleMessage(socket, raw, binary));
    socket.once("close", () => {
      connections.delete(socket);
      if (role === "publisher") endSession(session);
      else session.viewers.delete(socket);
      if (!connections.size) { clearInterval(timer); timer = null; }
    });
    send(socket, {
      type: "tracking.ready", role, ...snapshot(session),
      locationIntervalMs, locationTimeoutMs,
    });
    startTimer();
  }

  function rejectUpgrade(socket, status, code, message) {
    if (socket.destroyed || socket.writableEnded) return;
    const body = JSON.stringify({ error: message, code });
    const titles = { 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 409: "Conflict", 503: "Service Unavailable" };
    socket.end(`HTTP/1.1 ${status} ${titles[status] || "Error"}\r\nConnection: close\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  }

  function upgrade(request, socket, head) {
    let url;
    try { url = new URL(request.url, "http://localhost"); }
    catch { return; }
    const match = /^\/alerts\/tracking\/(publish|watch)\/?$/.exec(url.pathname);
    if (!match) return;
    const role = match[1] === "publish" ? "publisher" : "viewer";
    const socketError = () => socket.destroy();
    socket.on("error", socketError);
    pendingSockets.add(socket);
    const timeout = setTimeout(() => socket.destroy(), authTimeoutMs);
    timeout.unref();
    const cleanup = () => { clearTimeout(timeout); pendingSockets.delete(socket); };
    socket.once("close", cleanup);
    void (async () => {
      if (closed) fail(503, "server_shutdown", "El servidor se está reiniciando.");
      if (connections.size + pendingSockets.size > maxConnections) fail(503, "capacity", "No hay capacidad de seguimiento disponible.");
      if (url.searchParams.has("token") || url.searchParams.has("access_token")) {
        fail(400, "token_in_url", "Envía el token en Authorization: Bearer, nunca en la URL.");
      }
      const identity = await authenticate(request, role === "publisher" ? authenticateMember : authenticateUser,
        role === "publisher" ? "member" : "user");
      if (identity.exp * 1000 <= now()) fail(401, "unauthorized", "Token expirado.");
      checkLiveness();
      let context;
      if (role === "publisher") {
        const alertId = url.searchParams.get("alertId");
        if (!alertId || !/^[1-9]\d{0,19}$/.test(alertId)) fail(400, "invalid_alert_id", "El identificador de alerta no es válido.");
        const authorized = await authorizePublisher(alertId, identity);
        if (publishers.has(publisherKey(alertId, identity.email))) fail(409, "already_sharing", "Ya estás transmitiendo para esta alerta.");
        if (sessions.size >= maxStreams) fail(503, "capacity", "No hay capacidad de seguimiento disponible.");
        context = { role, identity, ...authorized };
      } else {
        const trackingId = url.searchParams.get("trackingId");
        const session = sessions.get(trackingId);
        if (!session) fail(404, "tracking_not_found", "No hay una transmisión activa con ese identificador.");
        const alert = await getAlert(session.alertId);
        if (!sameEmail(alert.email, identity.email)) fail(403, "not_alert_owner", "Solo puedes ver el seguimiento de tus alertas.");
        if (!parseStations(alert.attendingStations).includes(session.station) || !sameEmail(alert.email, session.userEmail)) {
          endSession(session, "authorization_changed");
          fail(409, "tracking_unavailable", "El seguimiento ya no está disponible.");
        }
        if (!sessions.has(trackingId)) fail(404, "tracking_not_found", "La transmisión se desconectó.");
        context = { role, identity, trackingId };
      }
      if (closed || socket.destroyed) return;
      if (identity.exp * 1000 <= now()) fail(401, "unauthorized", "Token expirado.");
      cleanup();
      wss.handleUpgrade(request, socket, head, client => {
        socket.removeListener("error", socketError);
        connected(client, context);
      });
    })().catch(error => {
      cleanup();
      if (!(error instanceof TrackingError)) logger.error("Error al abrir seguimiento de alerta:", error.message);
      rejectUpgrade(socket, error instanceof TrackingError ? error.status : 503,
        error instanceof TrackingError ? error.code : "tracking_unavailable",
        error instanceof TrackingError ? error.message : "No fue posible iniciar el seguimiento.");
    });
  }

  return {
    async listForUser(identity) {
      if (!identity?.email) fail(403, "unauthorized", "El usuario no tiene un correo válido.");
      await reconcile();
      return [...sessions.values()].filter(session => sameEmail(session.userEmail, identity.email)).map(snapshot);
    },
    async listForMember(identity) {
      await reconcile();
      return [...sessions.values()].filter(session => sameEmail(session.memberEmail, identity.email)).map(snapshot);
    },
    stop(trackingId, identity) {
      const session = sessions.get(trackingId);
      if (!session) fail(404, "tracking_not_found", "El seguimiento ya no está activo.");
      if (!sameEmail(session.memberEmail, identity.email)) fail(403, "not_publisher", "Solo quien transmite puede detener el seguimiento.");
      endSession(session, "member_stopped");
    },
    stopAlert(alertId) {
      for (const session of sessions.values()) {
        if (session.alertId === String(alertId)) endSession(session, "alert_inactive");
      }
    },
    reconcile,
    attach(httpServer) {
      if (server) throw new Error("El seguimiento ya está conectado al servidor HTTP.");
      server = httpServer;
      server.on("upgrade", upgrade);
      server.once("close", () => this.close());
    },
    close() {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      server?.removeListener("upgrade", upgrade);
      for (const session of sessions.values()) endSession(session, "server_shutdown");
      for (const socket of pendingSockets) socket.destroy();
      wss.close();
    },
  };
}

module.exports = { createAlertTracking, TrackingError };
