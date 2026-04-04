import "./load-env";
/**
 * Yantra Daemon — unified background server
 *
 * Combines:
 * - Terminal Server (PTY/WebSocket for AI panel Claude Code sessions)
 * - Job Scheduler (node-cron for agent jobs)
 * - WebSocket Event Bus (real-time updates to frontend)
 * - SQLite database initialization
 *
 * Usage: bun run dev:daemon:child
 */

import path from "path";
import http from "http";
import chokidar from "chokidar";
import { WebSocketServer } from "ws";
import { getDb, closeDb } from "./db";
import { createEventBusService } from "./event-bus";
import {
  createDaemonHttpHandler,
  extractDaemonRequestToken,
} from "./http-routes";
import { resolveDaemonProcessRuntime } from "./process-utils";
import { createPtySessionService } from "./pty-session-service";
import { createScheduleService } from "./schedule-service";
import { createWorkerService } from "./worker-service";
import { isDaemonTokenValid } from "../src/lib/agents/daemon-auth";
import { getYantraRoots } from "../src/lib/config/yantra-roots";

const PORT = 3001;
const HOST = process.env.YANTRA_DAEMON_HOST?.trim() || "127.0.0.1";
const ROOTS = getYantraRoots();
const DATA_DIR = ROOTS.vaultRoot;
const AGENTS_DIR = ROOTS.runtimeAgentsRoot;
const ALLOWED_BROWSER_ORIGINS = new Set(
  [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    ...(process.env.YANTRA_APP_ORIGIN
      ? process.env.YANTRA_APP_ORIGIN.split(",").map((value) => value.trim()).filter(Boolean)
      : []),
  ]
);

console.log("Initializing Yantra database...");
getDb();
console.log("Database ready.");

const processRuntime = resolveDaemonProcessRuntime();
const eventBus = createEventBusService();
const workerService = createWorkerService();
const sessionService = createPtySessionService({
  host: HOST,
  port: PORT,
  processRuntime,
});
const scheduleService = createScheduleService({
  agentsDir: AGENTS_DIR,
  onAgentSlugsChanged: (agentSlugs) => workerService.reconcileAgentSlugs(agentSlugs),
});
const httpHandler = createDaemonHttpHandler({
  host: HOST,
  port: PORT,
  allowedBrowserOrigins: ALLOWED_BROWSER_ORIGINS,
  sessionService,
  scheduleService,
  workerService,
  eventBus,
  tmuxAvailable: processRuntime.tmuxAvailable,
});

const server = http.createServer((req, res) => {
  void httpHandler(req, res).catch((error) => {
    console.error("Daemon HTTP handler error:", error);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
    }
    if (!res.writableEnded) {
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  });
});

const wssPty = new WebSocketServer({ noServer: true });
const wssEvents = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "", `http://localhost:${PORT}`);
  if (!isDaemonTokenValid(extractDaemonRequestToken(req, url))) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }

  if (url.pathname === "/events" || url.pathname === "/api/daemon/events") {
    wssEvents.handleUpgrade(req, socket, head, (ws) => {
      wssEvents.emit("connection", ws, req);
    });
  } else if (url.pathname === "/" || url.pathname === "/api/daemon/pty") {
    wssPty.handleUpgrade(req, socket, head, (ws) => {
      wssPty.emit("connection", ws, req);
    });
  } else {
    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
  }
});

wssPty.on("connection", (ws, req) => {
  sessionService.handleWebSocketConnection(ws, req as http.IncomingMessage);
});

wssEvents.on("connection", (ws) => {
  eventBus.handleConnection(ws);
});

const scheduleWatcher = chokidar.watch(
  [path.join(AGENTS_DIR, "*/persona.md"), path.join(AGENTS_DIR, "*/jobs/*.yaml")],
  {
    ignoreInitial: true,
  }
);

scheduleWatcher.on("all", () => {
  scheduleService.queueReload();
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`\nShutting down on ${signal}...`);

  scheduleService.stop();
  sessionService.shutdown();

  await Promise.allSettled([
    scheduleWatcher.close(),
    workerService.shutdown(),
    new Promise<void>((resolve) => {
      server.close(() => resolve());
    }),
  ]);

  closeDb();
  process.exit(0);
}

server.listen(PORT, HOST, () => {
  console.log(`Yantra Daemon running on ${HOST}:${PORT}`);
  console.log(`  Terminal WebSocket: ws://${HOST}:${PORT}/api/daemon/pty`);
  console.log(`  Events WebSocket: ws://${HOST}:${PORT}/api/daemon/events`);
  console.log(`  Session API: http://${HOST}:${PORT}/sessions`);
  console.log(`  Reload schedules: POST http://${HOST}:${PORT}/reload-schedules`);
  console.log(`  Health check: http://${HOST}:${PORT}/health`);
  console.log(`  Trigger endpoint: POST http://${HOST}:${PORT}/trigger`);
  console.log(`  Absurd queue prefix: ${workerService.getHealthSnapshot().absurdQueuePrefix}`);
  console.log(`  Using claude: ${processRuntime.claudePath}`);
  console.log(`  Using tmux: ${processRuntime.tmuxAvailable ? processRuntime.tmuxPath : "disabled (fallback to direct)"}`);
  console.log(`  Working directory: ${DATA_DIR}`);

  void scheduleService.reloadSchedules().catch((error) => {
    console.error("Failed to reload daemon schedules:", error);
  });
});

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

wssPty.on("error", (err) => {
  console.error("PTY WebSocket error:", err.message);
});

wssEvents.on("error", (err) => {
  console.error("Events WebSocket error:", err.message);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err.message);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});
