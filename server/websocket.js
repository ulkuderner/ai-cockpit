/**
 * @file WebSocket functionalities for real-time communication with clients, including connection management, heartbeat for detecting dead connections, and broadcasting messages to all connected clients.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { WebSocketServer } = require("ws");
const { isHostAllowed, isWebSocketAuthorized } = require("./lib/security");

let wss = null;

/**
 * Attach the dashboard WebSocket (`/ws`) to an HTTP(S) server. AI Cockpit may call this twice
 * (loopback HTTP + remote HTTPS listener); both share one WebSocketServer so broadcasts reach all.
 */
function initWebSocket(server) {
  // Express middleware doesn't run on WS upgrades, so enforce the same Host
  // allowlist (anti DNS-rebinding) and optional token here (GHSA-gr74-4xfh-6jw9).
  server.on("upgrade", (req, socket, head) => {
    let pathname = "";
    try {
      pathname = new URL(req.url, "http://localhost").pathname;
    } catch {
      /* malformed → rejected below */
    }
    if (pathname !== "/ws") return socket.destroy();
    const reject = (code, text) => {
      socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    if (!isHostAllowed(req.headers.host)) return reject(403, "Forbidden");
    if (!isWebSocketAuthorized(req)) return reject(401, "Unauthorized");
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });
  if (wss) return wss;
  wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  wss.on("connection", (ws) => {
    ws.isAlive = true;
    ws.on("pong", () => {
      ws.isAlive = true;
    });
    ws.on("error", (err) => {
      // Log but don't crash — client disconnects are normal
      if (err.code !== "ECONNRESET") {
        console.warn("[WS] client error:", err.code || err.message);
      }
    });
  });

  // Heartbeat every 30s to detect dead connections
  const interval = setInterval(() => {
    if (!wss) {
      clearInterval(interval);
      return;
    }
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        ws.terminate();
        return;
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);
  interval.unref();

  wss.on("close", () => {
    clearInterval(interval);
  });

  return wss;
}

function broadcast(type, data) {
  if (!wss) return;
  const message = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      try {
        client.send(message);
      } catch {
        // Client closed between readyState check and send — safe to ignore
      }
    }
  });
}

function getConnectionCount() {
  if (!wss) return 0;
  let count = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === 1) count++;
  });
  return count;
}

/**
 * Tear down the WebSocket server for a graceful shutdown. Open WS clients keep
 * their underlying TCP sockets alive, which prevents http.Server#close() from
 * ever completing — under `node --watch` that turns every restart into a
 * multi-second "waiting for graceful termination" stall. Terminating the
 * clients first lets the HTTP server drain and close promptly.
 */
function closeWebSocket() {
  if (!wss) return;
  wss.clients.forEach((client) => {
    try {
      client.terminate();
    } catch {
      /* already gone */
    }
  });
  try {
    wss.close();
  } catch {
    /* ignore */
  }
  wss = null;
}

module.exports = { initWebSocket, broadcast, getConnectionCount, closeWebSocket };
