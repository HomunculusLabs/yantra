import http from "http";
import path from "path";
import * as pty from "node-pty";
import { WebSocket } from "ws";
import {
  appendConversationTranscript,
  finalizeConversation,
  readConversationMeta,
  readConversationTranscript,
} from "../src/lib/agents/conversation-store";
import {
  getYantraRoots,
  isWithinRuntimeRoot,
  resolveVaultPath,
} from "../src/lib/config/yantra-roots";
import type { ResolvedLaunchSpec } from "../src/types/launchers";
import {
  type DaemonProcessRuntime,
  buildTmuxAttachCommand,
  buildTmuxSessionName,
  buildTmuxSpawnArgs,
  claudePromptReady,
  killTmuxSession,
  stripAnsi,
} from "./process-utils";

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

export interface CreatePtySessionInput {
  sessionId: string;
  prompt?: string;
  args?: string[];
  cwd?: string;
  launch?: ResolvedLaunchSpec;
  timeoutSeconds?: number;
  onData?: (chunk: string) => void;
}

export interface PtySessionSummary {
  id: string;
  createdAt: string;
  connected: boolean;
  exited: boolean;
  exitCode: number | null;
  launchTransport: "direct" | "tmux";
  tmuxSessionName: string | null;
  tmuxAttachCommand: string | null;
}

export interface SessionOutputResult {
  sessionId: string;
  status: string;
  output: string;
}

export interface PtySessionHandle {
  sessionId: string;
  launchTransport: "direct" | "tmux";
  tmuxSessionName: string | null;
  tmuxAttachCommand: string | null;
}

export interface PtySessionService {
  handleWebSocketConnection(ws: WebSocket, req: http.IncomingMessage): void;
  createOrReuseSession(input: CreatePtySessionInput): { existing: boolean; handle: PtySessionHandle };
  listSessions(): PtySessionSummary[];
  getSessionOutput(sessionId: string): Promise<SessionOutputResult | null>;
  getSessionCount(): number;
  terminateAll(): void;
  shutdown(): void;
}

interface CreatePtySessionServiceOptions {
  host: string;
  port: number;
  processRuntime: DaemonProcessRuntime;
}

export function createPtySessionService(
  options: CreatePtySessionServiceOptions
): PtySessionService {
  const sessions = new Map<string, PtySession>();
  const completedOutput = new Map<string, { output: string; completedAt: number }>();

  function resolveSessionCwd(input?: string): string {
    const { vaultRoot } = getYantraRoots();
    if (!input?.trim()) return vaultRoot;

    if (!path.isAbsolute(input)) {
      try {
        return resolveVaultPath(input);
      } catch {
        return vaultRoot;
      }
    }

    try {
      return resolveVaultPath(input);
    } catch {
      return isWithinRuntimeRoot(input) ? path.resolve(input) : vaultRoot;
    }
  }

  function toHandle(session: PtySession): PtySessionHandle {
    return {
      sessionId: session.id,
      launchTransport: session.launchTransport,
      tmuxSessionName: session.tmuxSessionName || null,
      tmuxAttachCommand: session.tmuxAttachCommand || null,
    };
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

  function bindSocket(session: PtySession, ws: WebSocket): void {
    session.ws = ws;

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

    ws.on("close", () => {
      console.log(`Session ${session.id} detached (WebSocket closed, PTY kept alive)`);
      if (session.ws === ws) {
        session.ws = null;
      }
    });
  }

  function createDetachedSession(input: CreatePtySessionInput): PtySession {
    const launch = input.launch
      ? {
          ...input.launch,
          transport: input.launch.transport || "direct",
        }
      : {
          command: options.processRuntime.claudePath,
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

    const shouldUseTmux = launch.transport === "tmux" && options.processRuntime.tmuxAvailable;
    if (launch.transport === "tmux" && !options.processRuntime.tmuxAvailable) {
      console.warn(
        `tmux requested for session ${input.sessionId}, but tmux is unavailable. Falling back to direct launch.`
      );
    }

    const tmuxSessionName = shouldUseTmux ? buildTmuxSessionName(input.sessionId) : undefined;
    const spawnCommand = tmuxSessionName ? options.processRuntime.tmuxPath : launch.command;
    const spawnArgs = tmuxSessionName
      ? buildTmuxSpawnArgs(launch, tmuxSessionName, options.processRuntime.enrichedPath)
      : launch.args;

    const term = pty.spawn(spawnCommand, spawnArgs, {
      name: "xterm-256color",
      cols: 120,
      rows: 30,
      cwd: launch.cwd,
      env: {
        ...(process.env as Record<string, string>),
        ...(launch.env || {}),
        PATH: options.processRuntime.enrichedPath,
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
      tmuxAttachCommand: tmuxSessionName
        ? buildTmuxAttachCommand(options.processRuntime.tmuxPath, tmuxSessionName)
        : undefined,
      terminate: () => {
        if (tmuxSessionName) {
          killTmuxSession(
            options.processRuntime.tmuxPath,
            tmuxSessionName,
            options.processRuntime.enrichedPath
          );
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

  const completedOutputCleanupInterval = setInterval(() => {
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [id, data] of completedOutput) {
      if (data.completedAt < cutoff) {
        completedOutput.delete(id);
      }
    }
  }, 5 * 60 * 1000);

  const exitedSessionCleanupInterval = setInterval(() => {
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

  return {
    handleWebSocketConnection(ws, req) {
      const url = new URL(req.url || "", `http://${options.host}:${options.port}`);
      const sessionId = url.searchParams.get("id") || `session-${Date.now()}`;
      const prompt = url.searchParams.get("prompt");
      const existing = sessions.get(sessionId);

      if (existing) {
        console.log(`Session ${sessionId} reconnected (exited=${existing.exited})`);
        existing.ws = ws;

        const replay = existing.output.join("");
        if (replay && ws.readyState === WebSocket.OPEN) {
          ws.send(replay);
        }

        if (existing.exited) {
          ws.send(`\r\n\x1b[90m[Process exited with code ${existing.exitCode}]\x1b[0m\r\n`);
          const raw = existing.output.join("");
          const plain = stripAnsi(raw);
          completedOutput.set(sessionId, { output: plain, completedAt: Date.now() });
          sessions.delete(sessionId);
          ws.close();
          return;
        }

        bindSocket(existing, ws);
        return;
      }

      let session: PtySession;
      try {
        session = createDetachedSession({
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

      console.log(`Session ${sessionId} started (${prompt ? "agent" : "interactive"} mode)`);

      const replay = session.output.join("");
      session.ws = ws;
      if (replay && ws.readyState === WebSocket.OPEN) {
        ws.send(replay);
      }

      bindSocket(session, ws);
    },

    createOrReuseSession(input) {
      const existing = sessions.get(input.sessionId);
      if (existing) {
        return {
          existing: true,
          handle: toHandle(existing),
        };
      }

      const session = createDetachedSession(input);
      return {
        existing: false,
        handle: toHandle(session),
      };
    },

    listSessions() {
      return Array.from(sessions.values()).map((session) => ({
        id: session.id,
        createdAt: session.createdAt.toISOString(),
        connected: session.ws !== null,
        exited: session.exited,
        exitCode: session.exitCode,
        launchTransport: session.launchTransport,
        tmuxSessionName: session.tmuxSessionName || null,
        tmuxAttachCommand: session.tmuxAttachCommand || null,
      }));
    },

    async getSessionOutput(sessionId) {
      const active = sessions.get(sessionId);
      if (active) {
        return {
          sessionId,
          status: active.exited
            ? active.exitCode === 0
              ? "completed"
              : "failed"
            : "running",
          output: stripAnsi(active.output.join("")),
        };
      }

      const conversationMeta = await readConversationMeta(sessionId).catch(() => null);
      if (conversationMeta) {
        const transcript = await readConversationTranscript(sessionId).catch(() => "");
        return {
          sessionId,
          status: conversationMeta.status,
          output: transcript,
        };
      }

      const completed = completedOutput.get(sessionId);
      if (completed) {
        return {
          sessionId,
          status: "completed",
          output: completed.output,
        };
      }

      return null;
    },

    getSessionCount() {
      return sessions.size;
    },

    terminateAll() {
      for (const [, session] of sessions) {
        session.terminate();
      }
    },

    shutdown() {
      clearInterval(completedOutputCleanupInterval);
      clearInterval(exitedSessionCleanupInterval);
      this.terminateAll();
    },
  };
}
