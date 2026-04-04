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
 * Usage: npx tsx server/yantra-daemon.ts
 */

import { WebSocketServer, WebSocket } from "ws";
import * as pty from "node-pty";
import path from "path";
import http from "http";
import fs from "fs";
import cron from "node-cron";
import yaml from "js-yaml";
import chokidar from "chokidar";
import { execFileSync, execSync } from "child_process";
import matter from "gray-matter";
import { getDb, closeDb } from "./db";
import {
  appendConversationTranscript,
  finalizeConversation,
  readConversationMeta,
  readConversationTranscript,
} from "../src/lib/agents/conversation-store";
import {
  getTokenFromAuthorizationHeader,
  isDaemonTokenValid,
} from "../src/lib/agents/daemon-auth";
import { getYantraRoots } from "../src/lib/config/yantra-roots";
import { getAbsurdQueueName, spawnJobTask, startAbsurdJobWorker, closeAbsurdJobWorker } from "../src/lib/jobs/absurd";
import type { ResolvedLaunchSpec } from "../src/types/launchers";

const PORT = 3001;
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

// ----- Database Initialization -----

console.log("Initializing Yantra database...");
getDb();
console.log("Database ready.");

// ----- Claude Binary Resolution -----

function resolveBinaryPath(
  binary: string,
  candidates: string[],
  fallbackLabel = binary
): string {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      console.log(`Found ${binary} at: ${candidate}`);
      return candidate;
    }
  }

  try {
    const resolved = execSync(`which ${binary}`, {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}`,
      },
    }).trim();
    if (resolved) {
      console.log(`Resolved ${binary} via which: ${resolved}`);
      return resolved;
    }
  } catch {}

  console.warn(`Could not resolve ${binary} path, using '${fallbackLabel}' directly`);
  return fallbackLabel;
}

const CLAUDE_PATH = resolveBinaryPath("claude", [
  path.join(process.env.HOME || "", ".local", "bin", "claude"),
  "/usr/local/bin/claude",
  "/opt/homebrew/bin/claude",
]);

const TMUX_PATH = resolveBinaryPath("tmux", [
  "/usr/bin/tmux",
  "/bin/tmux",
  "/usr/local/bin/tmux",
  "/opt/homebrew/bin/tmux",
]);

const enrichedPath = [
  `${process.env.HOME}/.local/bin`,
  process.env.PATH,
].join(":");

const TMUX_AVAILABLE = (() => {
  try {
    execFileSync(TMUX_PATH, ["-V"], {
      stdio: "ignore",
      env: {
        ...process.env,
        PATH: enrichedPath,
      },
    });
    return true;
  } catch {
    return false;
  }
})();

// ===== PTY Terminal Server =====

interface PtySession {
  id: string;
  pty: pty.IPty;
  ws: WebSocket | null;
  createdAt: Date;
  output: string[];
  exited: boolean;
  exitCode: number | null;
  launchTransport: ResolvedLaunchSpec["transport"];
  tmuxSessionName?: string;
  tmuxAttachCommand?: string;
  terminate: () => void;
  timeoutHandle?: NodeJS.Timeout;
  initialPrompt?: string;
  initialPromptSent?: boolean;
  initialPromptTimer?: NodeJS.Timeout;
  initialPromptMode?: "immediate" | "ready";
  initialPromptReadyPattern?: RegExp;
  initialPromptSubmit?: boolean;
}

const sessions = new Map<string, PtySession>();
const completedOutput = new Map<string, { output: string; completedAt: number }>();

function resolveSessionCwd(input?: string): string {
  if (!input) return DATA_DIR;

  const resolved = path.resolve(input);
  if (resolved.startsWith(DATA_DIR)) {
    return resolved;
  }

  return DATA_DIR;
}

function buildTmuxSessionName(sessionId: string): string {
  const sanitized = sessionId
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return `yantra-${sanitized || Date.now()}`;
}

function buildTmuxAttachCommand(sessionName: string): string {
  return `${TMUX_PATH} attach -t ${sessionName}`;
}

function killTmuxSession(sessionName: string): void {
  try {
    execFileSync(TMUX_PATH, ["kill-session", "-t", sessionName], {
      stdio: "ignore",
      env: {
        ...process.env,
        PATH: enrichedPath,
      },
    });
  } catch {
    // Ignore missing/already-exited sessions.
  }
}

function buildTmuxSpawnArgs(launch: ResolvedLaunchSpec, sessionName: string): string[] {
  const args = ["new-session", "-A", "-s", sessionName, "-c", launch.cwd];
  const tmuxEnv = {
    ...(launch.env || {}),
    PATH: enrichedPath,
    LANG: "en_US.UTF-8",
  };

  for (const [key, value] of Object.entries(tmuxEnv)) {
    if (process.env[key] !== value) {
      args.push("-e", `${key}=${value}`);
    }
  }

  args.push(launch.command, ...launch.args);
  return args;
}

function applyCors(req: http.IncomingMessage, res: http.ServerResponse): void {
  const origin = req.headers.origin;
  if (origin && ALLOWED_BROWSER_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
}

function requestToken(req: http.IncomingMessage, url: URL): string | null {
  const authHeader = Array.isArray(req.headers.authorization)
    ? req.headers.authorization[0]
    : req.headers.authorization;
  return getTokenFromAuthorizationHeader(authHeader) || url.searchParams.get("token");
}

function rejectUnauthorized(res: http.ServerResponse): void {
  res.writeHead(401, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Unauthorized" }));
}

function stripAnsi(str: string): string {
  return str.replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    ""
  );
}

function claudePromptReady(output: string): boolean {
  const plain = stripAnsi(output).replace(/\r/g, "\n");
  return (
    plain.includes("shift+tab to cycle") ||
    /(?:^|\n)[❯>]\s*$/.test(plain)
  );
}

function submitInitialPrompt(session: PtySession): void {
  if (!session.initialPrompt || session.initialPromptSent || session.exited) {
    return;
  }

  session.initialPromptSent = true;
  if (session.initialPromptTimer) {
    clearTimeout(session.initialPromptTimer);
    delete session.initialPromptTimer;
  }

  session.pty.write(session.initialPrompt);
  if (session.initialPromptSubmit !== false) {
    session.pty.write("\r");
  }
}

async function syncConversationChunk(sessionId: string, chunk: string): Promise<void> {
  const meta = await readConversationMeta(sessionId);
  if (!meta) return;
  await appendConversationTranscript(sessionId, chunk);
}

async function finalizeSessionConversation(session: PtySession): Promise<void> {
  const meta = await readConversationMeta(session.id);
  if (!meta) return;

  const plain = stripAnsi(session.output.join(""));
  await finalizeConversation(session.id, {
    status: session.exitCode === 0 ? "completed" : "failed",
    exitCode: session.exitCode,
    output: plain,
  });
}

// Cleanup old completed output every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, data] of completedOutput) {
    if (data.completedAt < cutoff) {
      completedOutput.delete(id);
    }
  }
}, 5 * 60 * 1000);

// Cleanup detached sessions that have exited and been idle for 10 minutes
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [id, session] of sessions) {
    if (session.exited && !session.ws && session.createdAt.getTime() < cutoff) {
      const raw = session.output.join("");
      const plain = stripAnsi(raw);
      completedOutput.set(id, { output: plain, completedAt: Date.now() });
      sessions.delete(id);
      console.log(`Cleaned up exited detached session ${id}`);
    }
  }
}, 60 * 1000);

function handlePtyConnection(ws: WebSocket, req: http.IncomingMessage): void {
  const url = new URL(req.url || "", `http://localhost:${PORT}`);
  const sessionId = url.searchParams.get("id") || `session-${Date.now()}`;
  const prompt = url.searchParams.get("prompt");

  // Check if this is a reconnection to an existing session
  const existing = sessions.get(sessionId);
  if (existing) {
    console.log(`Session ${sessionId} reconnected (exited=${existing.exited})`);
    existing.ws = ws;

    // Replay all buffered output so the client sees the full history
    const replay = existing.output.join("");
    if (replay && ws.readyState === WebSocket.OPEN) {
      ws.send(replay);
    }

    // If the process already exited while detached, notify and clean up
    if (existing.exited) {
      ws.send(`\r\n\x1b[90m[Process exited with code ${existing.exitCode}]\x1b[0m\r\n`);
      const raw = existing.output.join("");
      const plain = stripAnsi(raw);
      completedOutput.set(sessionId, { output: plain, completedAt: Date.now() });
      sessions.delete(sessionId);
      ws.close();
      return;
    }

    // Wire up input from the new WebSocket to the existing PTY
    ws.on("message", (data: Buffer) => {
      const msg = data.toString();
      try {
        const parsed = JSON.parse(msg);
        if (parsed.type === "resize" && parsed.cols && parsed.rows) {
          existing.pty.resize(parsed.cols, parsed.rows);
          return;
        }
      } catch {
        // Not JSON, treat as terminal input
      }
      existing.pty.write(msg);
    });

    // On disconnect again, just detach — don't kill
    ws.on("close", () => {
      console.log(`Session ${sessionId} detached (WebSocket closed, PTY kept alive)`);
      existing.ws = null;
    });

    return;
  }

  // New session — spawn PTY
  try {
    createDetachedSession({
      sessionId,
      prompt: prompt || undefined,
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to spawn PTY for session ${sessionId}:`, errMsg);
    ws.send(`\r\n\x1b[31mError: Failed to start Claude CLI\x1b[0m\r\n`);
    ws.send(`\x1b[90m${errMsg}\x1b[0m\r\n`);
    ws.send(`\r\n\x1b[33mMake sure 'claude' is installed and accessible.\x1b[0m\r\n`);
    ws.close();
    return;
  }
  const session = sessions.get(sessionId)!;
  session.ws = ws;
  console.log(`Session ${sessionId} started (${prompt ? "agent" : "interactive"} mode)`);

  const replay = session.output.join("");
  if (replay && ws.readyState === WebSocket.OPEN) {
    ws.send(replay);
  }

  // WebSocket input → PTY
  ws.on("message", (data: Buffer) => {
    const msg = data.toString();
    try {
      const parsed = JSON.parse(msg);
      if (parsed.type === "resize" && parsed.cols && parsed.rows) {
        session.pty.resize(parsed.cols, parsed.rows);
        return;
      }
    } catch {
      // Not JSON, treat as terminal input
    }
    session.pty.write(msg);
  });

  // On WebSocket close: DETACH, don't kill the PTY
  ws.on("close", () => {
    console.log(`Session ${sessionId} detached (WebSocket closed, PTY kept alive)`);
    session.ws = null;
  });

}

function createDetachedSession(input: {
  sessionId: string;
  prompt?: string;
  args?: string[];
  cwd?: string;
  launch?: ResolvedLaunchSpec;
  timeoutSeconds?: number;
  onData?: (chunk: string) => void;
}): PtySession {
  const launch = input.launch
    ? {
        ...input.launch,
        transport: input.launch.transport || "direct",
      }
    : {
        command: CLAUDE_PATH,
        args: input.args ? input.args : ["--dangerously-skip-permissions"],
        cwd: resolveSessionCwd(input.cwd),
        env: {},
        promptDelivery: input.args
          ? { method: "none" as const }
          : {
              method: "pty_write" as const,
              when: "ready" as const,
              readyPattern: "(?:^|\\n)[❯>]\\s*$",
              submit: true,
            },
        transport: "direct" as const,
      };

  const shouldUseTmux = launch.transport === "tmux" && TMUX_AVAILABLE;
  if (launch.transport === "tmux" && !TMUX_AVAILABLE) {
    console.warn(
      `tmux requested for session ${input.sessionId}, but tmux is unavailable. Falling back to direct launch.`
    );
  }

  const tmuxSessionName = shouldUseTmux ? buildTmuxSessionName(input.sessionId) : undefined;
  const spawnCommand = tmuxSessionName ? TMUX_PATH : launch.command;
  const spawnArgs = tmuxSessionName
    ? buildTmuxSpawnArgs(launch, tmuxSessionName)
    : launch.args;

  const term = pty.spawn(spawnCommand, spawnArgs, {
    name: "xterm-256color",
    cols: 120,
    rows: 30,
    cwd: launch.cwd,
    env: {
      ...(process.env as Record<string, string>),
      ...(launch.env || {}),
      PATH: enrichedPath,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      FORCE_COLOR: "3",
      LANG: "en_US.UTF-8",
    },
  });

  const promptDelivery = launch.promptDelivery;
  const session: PtySession = {
    id: input.sessionId,
    pty: term,
    ws: null,
    createdAt: new Date(),
    output: [],
    exited: false,
    exitCode: null,
    launchTransport: shouldUseTmux ? "tmux" : "direct",
    tmuxSessionName,
    tmuxAttachCommand: tmuxSessionName ? buildTmuxAttachCommand(tmuxSessionName) : undefined,
    terminate: () => {
      if (tmuxSessionName) {
        killTmuxSession(tmuxSessionName);
        return;
      }
      try {
        term.kill();
      } catch {}
    },
    initialPrompt:
      promptDelivery.method === "pty_write" ? input.prompt?.trim() || undefined : undefined,
    initialPromptSent: promptDelivery.method !== "pty_write",
    initialPromptMode:
      promptDelivery.method === "pty_write" ? promptDelivery.when : undefined,
    initialPromptReadyPattern:
      promptDelivery.method === "pty_write" && promptDelivery.readyPattern
        ? new RegExp(promptDelivery.readyPattern)
        : undefined,
    initialPromptSubmit:
      promptDelivery.method === "pty_write" ? promptDelivery.submit !== false : false,
  };
  sessions.set(input.sessionId, session);

  if (tmuxSessionName) {
    console.log(
      `Session ${input.sessionId} is running in tmux session ${tmuxSessionName} (${session.tmuxAttachCommand})`
    );
  }

  term.onData((data: string) => {
    session.output.push(data);
    if (session.initialPrompt && !session.initialPromptSent) {
      const output = session.output.join("");
      const ready = session.initialPromptReadyPattern
        ? session.initialPromptReadyPattern.test(stripAnsi(output).replace(/\r/g, "\n"))
        : claudePromptReady(output);
      if (session.initialPromptMode === "ready" && ready) {
        submitInitialPrompt(session);
      }
    }
    void syncConversationChunk(input.sessionId, data).catch(() => {});
    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(data);
    }
    input.onData?.(data);
  });

  term.onExit(({ exitCode }) => {
    console.log(`Session ${input.sessionId} PTY exited with code ${exitCode}`);
    session.exited = true;
    session.exitCode = exitCode;
    if (session.timeoutHandle) {
      clearTimeout(session.timeoutHandle);
      delete session.timeoutHandle;
    }
    if (session.initialPromptTimer) {
      clearTimeout(session.initialPromptTimer);
      delete session.initialPromptTimer;
    }

    const plain = stripAnsi(session.output.join(""));
    completedOutput.set(input.sessionId, { output: plain, completedAt: Date.now() });
    void finalizeSessionConversation(session).catch(() => {});

    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      sessions.delete(input.sessionId);
      session.ws.close();
    }
  });

  if (input.timeoutSeconds && input.timeoutSeconds > 0) {
    session.timeoutHandle = setTimeout(() => {
      console.warn(`Session ${input.sessionId} timed out after ${input.timeoutSeconds}s`);
      session.terminate();
    }, input.timeoutSeconds * 1000);
  }

  if (session.initialPrompt) {
    session.initialPromptTimer = setTimeout(() => {
      submitInitialPrompt(session);
    }, session.initialPromptMode === "immediate" ? 50 : 1500);
  }

  return session;
}

// ===== WebSocket Event Bus =====

interface EventSubscriber {
  ws: WebSocket;
  channels: Set<string>;
}

const subscribers: EventSubscriber[] = [];

function broadcast(channel: string, data: Record<string, unknown>): void {
  const message = JSON.stringify({ channel, ...data });
  for (const sub of subscribers) {
    if (sub.channels.has(channel) || sub.channels.has("*")) {
      if (sub.ws.readyState === WebSocket.OPEN) {
        sub.ws.send(message);
      }
    }
  }
}

function handleEventBusConnection(ws: WebSocket): void {
  const subscriber: EventSubscriber = { ws, channels: new Set(["*"]) };
  subscribers.push(subscriber);

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.subscribe) {
        subscriber.channels.add(msg.subscribe);
      }
      if (msg.unsubscribe) {
        subscriber.channels.delete(msg.unsubscribe);
      }
    } catch {
      // ignore
    }
  });

  ws.on("close", () => {
    const idx = subscribers.indexOf(subscriber);
    if (idx >= 0) subscribers.splice(idx, 1);
  });
}

// ===== Job Scheduler =====

interface JobConfig {
  id: string;
  name: string;
  enabled: boolean;
  schedule: string;
  prompt: string;
  timeout?: number;
  agentSlug: string;
}

const scheduledJobs = new Map<string, ReturnType<typeof cron.schedule>>();
const scheduledHeartbeats = new Map<string, ReturnType<typeof cron.schedule>>();
let scheduleReloadTimer: NodeJS.Timeout | null = null;
let absurdWorkerReady = false;
let absurdWorkerRetryTimer: NodeJS.Timeout | null = null;
let shuttingDown = false;

async function putJson(url: string, body: Record<string, unknown>): Promise<void> {
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
}

function stopScheduledTasks(): void {
  for (const [, task] of scheduledJobs) task.stop();
  for (const [, task] of scheduledHeartbeats) task.stop();
  scheduledJobs.clear();
  scheduledHeartbeats.clear();
}

function scheduleJob(job: JobConfig): void {
  const key = `${job.agentSlug}/${job.id}`;

  if (!cron.validate(job.schedule)) {
    console.warn(`Invalid cron schedule for job ${key}: ${job.schedule}`);
    return;
  }

  const task = cron.schedule(job.schedule, () => {
    console.log(`Triggering scheduled job ${key}`);
    const scheduledFireTime = new Date().toISOString();
    void spawnJobTask({
      agentSlug: job.agentSlug,
      jobId: job.id,
      source: "scheduler",
      idempotencyKey: `job:${job.agentSlug}:${job.id}:${scheduledFireTime}`,
    })
      .then((spawned) => {
        console.log(
          `Enqueued scheduled job ${key} on Absurd queue ${getAbsurdQueueName()} ` +
          `as task ${spawned.taskID}${spawned.created ? "" : " (deduped)"}`
        );
      })
      .catch((error) => {
        console.error(`Failed to enqueue scheduled job ${key}:`, error);
      });
  });

  scheduledJobs.set(key, task);
  console.log(`  Scheduled job: ${key} (${job.schedule})`);
}

function scheduleHeartbeat(slug: string, cronExpr: string): void {
  if (!cron.validate(cronExpr)) {
    console.warn(`Invalid heartbeat schedule for ${slug}: ${cronExpr}`);
    return;
  }

  const task = cron.schedule(cronExpr, () => {
    console.log(`Triggering heartbeat ${slug}`);
    void putJson(`http://localhost:3000/api/agents/personas/${slug}`, {
      action: "run",
      source: "scheduler",
    }).catch((error) => {
      console.error(`Failed to trigger heartbeat ${slug}:`, error);
    });
  });

  scheduledHeartbeats.set(slug, task);
  console.log(`  Scheduled heartbeat: ${slug} (${cronExpr})`);
}

async function reloadSchedules(): Promise<void> {
  stopScheduledTasks();

  if (!fs.existsSync(AGENTS_DIR)) return;

  const entries = fs.readdirSync(AGENTS_DIR, { withFileTypes: true });
  let jobCount = 0;
  let heartbeatCount = 0;

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

    const personaPath = path.join(AGENTS_DIR, entry.name, "persona.md");
    if (fs.existsSync(personaPath)) {
      try {
        const rawPersona = fs.readFileSync(personaPath, "utf-8");
        const { data } = matter(rawPersona);
        const active = data.active !== false;
        const heartbeat = typeof data.heartbeat === "string" ? data.heartbeat : "";
        if (active && heartbeat) {
          scheduleHeartbeat(entry.name, heartbeat);
          heartbeatCount++;
        }
      } catch {
        // Skip malformed personas.
      }
    }

    const jobsDir = path.join(AGENTS_DIR, entry.name, "jobs");
    if (!fs.existsSync(jobsDir)) continue;

    const jobFiles = fs.readdirSync(jobsDir);
    for (const jf of jobFiles) {
      if (!jf.endsWith(".yaml")) continue;

      try {
        const raw = fs.readFileSync(path.join(jobsDir, jf), "utf-8");
        const config = yaml.load(raw) as JobConfig;
        if (config && config.id && config.enabled && config.schedule) {
          config.agentSlug = entry.name;
          scheduleJob(config);
          jobCount++;
        }
      } catch {
        // Skip malformed jobs.
      }
    }
  }

  console.log(`Scheduled ${jobCount} jobs and ${heartbeatCount} heartbeats.`);
}

function queueScheduleReload(): void {
  if (scheduleReloadTimer) {
    clearTimeout(scheduleReloadTimer);
  }

  scheduleReloadTimer = setTimeout(() => {
    scheduleReloadTimer = null;
    void reloadSchedules().catch((error) => {
      console.error("Failed to reload daemon schedules:", error);
    });
  }, 200);
}

function bootAbsurdWorker(attempt = 1): void {
  if (shuttingDown) return;

  void startAbsurdJobWorker()
    .then(() => {
      absurdWorkerReady = true;
      console.log(`Absurd worker started for queue ${getAbsurdQueueName()}.`);
    })
    .catch((error) => {
      absurdWorkerReady = false;
      const delayMs = Math.min(30000, attempt * 5000);
      console.error(
        `Failed to start Absurd worker (attempt ${attempt}). ` +
        `Make sure ABSURD_DATABASE_URL is reachable and the Absurd schema is initialized. ` +
        `Retrying in ${Math.round(delayMs / 1000)}s.`,
        error
      );

      absurdWorkerRetryTimer = setTimeout(() => {
        absurdWorkerRetryTimer = null;
        bootAbsurdWorker(attempt + 1);
      }, delayMs);
    });
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`\nShutting down on ${signal}...`);

  if (absurdWorkerRetryTimer) {
    clearTimeout(absurdWorkerRetryTimer);
    absurdWorkerRetryTimer = null;
  }

  for (const [, task] of scheduledJobs) {
    task.stop();
  }
  for (const [, task] of scheduledHeartbeats) {
    task.stop();
  }
  for (const [, session] of sessions) {
    session.terminate();
  }

  await Promise.allSettled([
    scheduleWatcher.close(),
    closeAbsurdJobWorker(),
    new Promise<void>((resolve) => {
      server.close(() => resolve());
    }),
  ]);

  closeDb();
  process.exit(0);
}

// ===== HTTP Server =====

const server = http.createServer(async (req, res) => {
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || "", `http://localhost:${PORT}`);
  if (url.pathname !== "/health" && !isDaemonTokenValid(requestToken(req, url))) {
    rejectUnauthorized(res);
    return;
  }

  // GET /session/:id/output — retrieve captured output for a completed session
  const outputMatch = url.pathname.match(/^\/session\/([^/]+)\/output$/);
  if (outputMatch && req.method === "GET") {
    const sessionId = decodeURIComponent(outputMatch[1]);

    const active = sessions.get(sessionId);
    if (active) {
      const raw = active.output.join("");
      const plain = stripAnsi(raw);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          sessionId,
          status: active.exited
            ? active.exitCode === 0
              ? "completed"
              : "failed"
            : "running",
          output: plain,
        })
      );
      return;
    }

    const conversationMeta = await readConversationMeta(sessionId).catch(() => null);
    if (conversationMeta) {
      const transcript = await readConversationTranscript(sessionId).catch(() => "");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          sessionId,
          status: conversationMeta.status,
          output: transcript,
        })
      );
      return;
    }

    const completed = completedOutput.get(sessionId);
    if (completed) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ sessionId, status: "completed", output: completed.output }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Session not found" }));
    return;
  }

  // POST /sessions — create a PTY session without a WebSocket (for agent heartbeats)
  if (url.pathname === "/sessions" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const {
          id,
          args,
          prompt,
          cwd,
          launch,
          timeoutSeconds,
        } = JSON.parse(body) as {
          id: string;
          args?: string[];
          prompt?: string;
          cwd?: string;
          launch?: ResolvedLaunchSpec;
          timeoutSeconds?: number;
        };
        const sessionId = id || `session-${Date.now()}`;

        if (sessions.has(sessionId)) {
          const existing = sessions.get(sessionId)!;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              sessionId,
              existing: true,
              launchTransport: existing.launchTransport,
              tmuxSessionName: existing.tmuxSessionName || null,
              tmuxAttachCommand: existing.tmuxAttachCommand || null,
            })
          );
          return;
        }

        let session: PtySession;
        try {
          session = createDetachedSession({
            sessionId,
            args,
            prompt,
            cwd,
            launch,
            timeoutSeconds,
          });
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: errMsg }));
          return;
        }

        console.log(`Session ${sessionId} started via HTTP (agent mode)`);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            sessionId,
            launchTransport: session.launchTransport,
            tmuxSessionName: session.tmuxSessionName || null,
            tmuxAttachCommand: session.tmuxAttachCommand || null,
          })
        );
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
    return;
  }

  // GET /sessions — list all active sessions
  if (url.pathname === "/sessions" && req.method === "GET") {
    const activeSessions = Array.from(sessions.values()).map((s) => ({
      id: s.id,
      createdAt: s.createdAt.toISOString(),
      connected: s.ws !== null,
      exited: s.exited,
      exitCode: s.exitCode,
      launchTransport: s.launchTransport,
      tmuxSessionName: s.tmuxSessionName || null,
      tmuxAttachCommand: s.tmuxAttachCommand || null,
    }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(activeSessions));
    return;
  }

  if (url.pathname === "/reload-schedules" && req.method === "POST") {
    try {
      await reloadSchedules();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          jobs: scheduledJobs.size,
          heartbeats: scheduledHeartbeats.size,
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    }
    return;
  }

  // Health check
  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        ptySessions: sessions.size,
        scheduledJobs: scheduledJobs.size,
        scheduledHeartbeats: scheduledHeartbeats.size,
        absurdQueue: getAbsurdQueueName(),
        absurdWorkerReady,
        subscribers: subscribers.length,
      })
    );
    return;
  }

  // Trigger job manually
  if (url.pathname === "/trigger" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { agentSlug, jobId, prompt, timeoutSeconds } = JSON.parse(body);
        if (prompt) {
          const sessionId = jobId || `manual-${Date.now()}`;
          createDetachedSession({
            sessionId,
            prompt,
            timeoutSeconds,
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, sessionId, agentSlug: agentSlug || "manual" }));
        } else {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "prompt is required" }));
        }
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

// ===== WebSocket Servers =====

// PTY terminal WebSocket — root path (what AI panel and web terminal connect to)
const wssPty = new WebSocketServer({ noServer: true });

// Event bus WebSocket — /events path
const wssEvents = new WebSocketServer({ noServer: true });

// Route WebSocket upgrades based on path
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "", `http://localhost:${PORT}`);
  if (!isDaemonTokenValid(requestToken(req, url))) {
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
  handlePtyConnection(ws, req as http.IncomingMessage);
});

wssEvents.on("connection", (ws) => {
  handleEventBusConnection(ws);
});

// ===== Startup =====

const scheduleWatcher = chokidar.watch(
  [path.join(AGENTS_DIR, "*/persona.md"), path.join(AGENTS_DIR, "*/jobs/*.yaml")],
  {
    ignoreInitial: true,
  }
);

scheduleWatcher.on("all", () => {
  queueScheduleReload();
});

server.listen(PORT, () => {
  console.log(`Yantra Daemon running on port ${PORT}`);
  console.log(`  Terminal WebSocket: ws://localhost:${PORT}/api/daemon/pty`);
  console.log(`  Events WebSocket: ws://localhost:${PORT}/api/daemon/events`);
  console.log(`  Session API: http://localhost:${PORT}/sessions`);
  console.log(`  Reload schedules: POST http://localhost:${PORT}/reload-schedules`);
  console.log(`  Health check: http://localhost:${PORT}/health`);
  console.log(`  Trigger endpoint: POST http://localhost:${PORT}/trigger`);
  console.log(`  Absurd queue: ${getAbsurdQueueName()}`);
  console.log(`  Using claude: ${CLAUDE_PATH}`);
  console.log(`  Using tmux: ${TMUX_AVAILABLE ? TMUX_PATH : "disabled (fallback to direct)"}`);
  console.log(`  Working directory: ${DATA_DIR}`);

  bootAbsurdWorker();
  void reloadSchedules();
});

// ===== Graceful Shutdown =====

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
