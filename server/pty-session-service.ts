import http from "http";
import path from "path";
import * as pty from "node-pty";
import { WebSocket } from "ws";
import type {
  ConversationRuntimeSnapshot,
  ConversationStatus,
} from "../src/types/conversations";
import {
  appendConversationTranscript,
  finalizeConversation,
  readConversationMeta,
  readConversationTranscript,
} from "../src/lib/agents/conversation-store";
import {
  buildLiveOutputExcerpt,
  makeSummaryFromOutput,
  parseYantraBlock,
} from "../src/lib/agents/conversation-output-parser";
import {
  getYantraRoots,
  isWithinRuntimeRoot,
  resolveVaultPath,
} from "../src/lib/config/yantra-roots";
import type { ResolvedLaunchSpec } from "../src/types/launchers";
import {
  type DaemonProcessRuntime,
  buildTmuxAttachArgs,
  buildTmuxAttachCommand,
  buildTmuxSessionName,
  buildTmuxSpawnArgs,
  claudePromptReady,
  hasTmuxSession,
  killTmuxSession,
  stripAnsi,
} from "./process-utils";
import {
  consumePreservedTmuxSessions,
  type PersistedTmuxSessionRef,
  writePreservedTmuxSessions,
  clearPreservedTmuxSessions,
} from "./preserved-session-store";

export type DaemonShutdownMode = "soft" | "force";

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
  shutdownDisposition?: "preserve_tmux" | "terminate";
  restoredFromPreserved?: boolean;
  supportsStructuredEvents: boolean;
  runtimeSequence: number;
  runtimeSnapshot: ConversationRuntimeSnapshot | null;
  runtimeSubscribers: Set<(snapshot: ConversationRuntimeSnapshot) => void>;
  runtimeFlushTimer?: NodeJS.Timeout;
  runtimeLastVersion?: string;
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
  restoredFromPreserved: boolean;
}

export interface SessionRestartPlan {
  activeSessionCount: number;
  directSessionCount: number;
  tmuxSessionCount: number;
  restoredTmuxSessionCount: number;
  preservableTmuxSessionCount: number;
  softSafe: boolean;
}

export interface SessionShutdownSummary extends SessionRestartPlan {
  mode: DaemonShutdownMode;
  directSessionsTerminated: number;
  tmuxSessionsPreserved: number;
  tmuxSessionsTerminated: number;
}

export interface RestoreSummary {
  restoredTmuxSessions: number;
  droppedTmuxSessions: number;
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
  eventStreamFormat?: "structured_v1";
}

export interface PtySessionService {
  handleWebSocketConnection(ws: WebSocket, req: http.IncomingMessage): void;
  createOrReuseSession(input: CreatePtySessionInput): { existing: boolean; handle: PtySessionHandle };
  listSessions(): PtySessionSummary[];
  getSessionOutput(sessionId: string): Promise<SessionOutputResult | null>;
  getRuntimeSnapshot(sessionId: string): ConversationRuntimeSnapshot | null;
  subscribeToRuntimeSnapshots(
    sessionId: string,
    listener: (snapshot: ConversationRuntimeSnapshot) => void
  ): (() => void) | null;
  getSessionCount(): number;
  getRestartPlan(): SessionRestartPlan;
  restorePreservedSessions(): Promise<RestoreSummary>;
  terminateAll(): void;
  shutdown(mode: DaemonShutdownMode): Promise<SessionShutdownSummary>;
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
      eventStreamFormat: session.supportsStructuredEvents
        ? "structured_v1"
        : undefined,
    };
  }

  function clearSessionTimers(session: PtySession): void {
    if (session.timeoutHandle) {
      clearTimeout(session.timeoutHandle);
      delete session.timeoutHandle;
    }
    if (session.initialPromptTimer) {
      clearTimeout(session.initialPromptTimer);
      delete session.initialPromptTimer;
    }
    if (session.runtimeFlushTimer) {
      clearTimeout(session.runtimeFlushTimer);
      delete session.runtimeFlushTimer;
    }
  }

  function resolveRuntimeStatus(session: PtySession): ConversationStatus {
    if (!session.exited) {
      return "running";
    }

    return session.exitCode === 0 ? "completed" : "failed";
  }

  function buildRuntimeSnapshot(
    session: PtySession
  ): Omit<ConversationRuntimeSnapshot, "sequence" | "updatedAt"> | null {
    if (!session.supportsStructuredEvents) {
      return null;
    }

    const status = resolveRuntimeStatus(session);
    const output = stripAnsi(session.output.join(""));
    const parsed = parseYantraBlock(output);
    const excerpt = buildLiveOutputExcerpt(output);
    const excerptLines = excerpt
      ? excerpt
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
      : [];
    const summary =
      parsed.summary ||
      excerptLines[0] ||
      makeSummaryFromOutput(output) ||
      (status === "running"
        ? "Working…"
        : status === "failed"
          ? "Run failed."
          : "Completed.");
    const body = parsed.summary
      ? excerpt
      : excerptLines.length > 1
        ? excerptLines.slice(1).join("\n")
        : undefined;

    return {
      sessionId: session.id,
      status,
      runtimeSession: {
        launchTransport: session.launchTransport,
        startedAt: session.createdAt.toISOString(),
        tmuxSessionName: session.tmuxSessionName,
        tmuxAttachCommand: session.tmuxAttachCommand,
        exitedAt: session.exited ? new Date().toISOString() : undefined,
        exitCode: session.exited ? session.exitCode : undefined,
        eventStreamFormat: "structured_v1",
      },
      assistant: {
        summary,
        body,
        contextSummary: parsed.contextSummary,
        artifacts: parsed.artifactPaths.map((artifactPath) => ({
          path: artifactPath,
        })),
      },
    };
  }

  function emitRuntimeSnapshot(session: PtySession): void {
    const nextSnapshot = buildRuntimeSnapshot(session);
    if (!nextSnapshot) {
      return;
    }

    const version = JSON.stringify({
      status: nextSnapshot.status,
      runtimeSession: nextSnapshot.runtimeSession,
      assistant: nextSnapshot.assistant,
    });
    if (version === session.runtimeLastVersion && session.runtimeSnapshot) {
      return;
    }

    session.runtimeLastVersion = version;
    session.runtimeSequence += 1;
    session.runtimeSnapshot = {
      ...nextSnapshot,
      sequence: session.runtimeSequence,
      updatedAt: new Date().toISOString(),
    };

    for (const listener of Array.from(session.runtimeSubscribers)) {
      try {
        listener(session.runtimeSnapshot);
      } catch (error) {
        console.warn(`Runtime snapshot listener failed for session ${session.id}:`, error);
      }
    }
  }

  function scheduleRuntimeSnapshotFlush(session: PtySession): void {
    if (!session.supportsStructuredEvents || session.runtimeFlushTimer) {
      return;
    }

    session.runtimeFlushTimer = setTimeout(() => {
      delete session.runtimeFlushTimer;
      emitRuntimeSnapshot(session);
    }, 200);
  }

  function getRestartPlan(): SessionRestartPlan {
    let activeSessionCount = 0;
    let directSessionCount = 0;
    let tmuxSessionCount = 0;
    let restoredTmuxSessionCount = 0;

    for (const session of sessions.values()) {
      if (session.exited) continue;
      activeSessionCount += 1;
      if (session.launchTransport === "tmux") {
        tmuxSessionCount += 1;
        if (session.restoredFromPreserved) {
          restoredTmuxSessionCount += 1;
        }
      } else {
        directSessionCount += 1;
      }
    }

    return {
      activeSessionCount,
      directSessionCount,
      tmuxSessionCount,
      restoredTmuxSessionCount,
      preservableTmuxSessionCount: tmuxSessionCount,
      softSafe: directSessionCount === 0,
    };
  }

  function buildPreservableTmuxRefs(): PersistedTmuxSessionRef[] {
    return Array.from(sessions.values())
      .filter(
        (session) =>
          !session.exited &&
          session.launchTransport === "tmux" &&
          Boolean(session.tmuxSessionName) &&
          Boolean(session.tmuxAttachCommand)
      )
      .map((session) => ({
        sessionId: session.id,
        createdAt: session.createdAt.toISOString(),
        tmuxSessionName: session.tmuxSessionName!,
        tmuxAttachCommand: session.tmuxAttachCommand!,
      }));
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

    const plain = session.restoredFromPreserved
      ? await readConversationTranscript(session.id).catch(() => stripAnsi(session.output.join("")))
      : stripAnsi(session.output.join(""));
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

  function registerSession(
    session: PtySession,
    input?: Pick<CreatePtySessionInput, "onData" | "timeoutSeconds">
  ): PtySession {
    sessions.set(session.id, session);

    session.pty.onData((data: string) => {
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
      scheduleRuntimeSnapshotFlush(session);
      void syncConversationChunk(session.id, data).catch(() => {});
      if (session.ws && session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(data);
      }
      input?.onData?.(data);
    });

    session.pty.onExit(({ exitCode }) => {
      console.log(`Session ${session.id} PTY exited with code ${exitCode}`);
      session.exited = true;
      session.exitCode = exitCode;
      clearSessionTimers(session);
      emitRuntimeSnapshot(session);

      if (session.shutdownDisposition === "preserve_tmux") {
        return;
      }

      const plain = stripAnsi(session.output.join(""));
      completedOutput.set(session.id, { output: plain, completedAt: Date.now() });
      void finalizeSessionConversation(session).catch(() => {});

      if (session.ws && session.ws.readyState === WebSocket.OPEN) {
        sessions.delete(session.id);
        session.ws.close();
      }
    });

    if (input?.timeoutSeconds && input.timeoutSeconds > 0) {
      session.timeoutHandle = setTimeout(() => {
        console.warn(`Session ${session.id} timed out after ${input.timeoutSeconds}s`);
        session.terminate();
      }, input.timeoutSeconds * 1000);
    }

    if (session.initialPrompt) {
      session.initialPromptTimer = setTimeout(() => {
        submitInitialPrompt(session);
      }, session.initialPromptMode === "immediate" ? 50 : 1500);
    }

    emitRuntimeSnapshot(session);

    return session;
  }

  function createAttachedTmuxSession(ref: PersistedTmuxSessionRef): PtySession {
    const term = pty.spawn(
      options.processRuntime.tmuxPath,
      buildTmuxAttachArgs(ref.tmuxSessionName),
      {
        name: "xterm-256color",
        cols: 120,
        rows: 30,
        cwd: getYantraRoots().vaultRoot,
        env: {
          ...(process.env as Record<string, string>),
          PATH: options.processRuntime.enrichedPath,
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
          FORCE_COLOR: "3",
          LANG: "en_US.UTF-8",
        },
      }
    );

    return registerSession(
      {
        id: ref.sessionId,
        pty: term,
        ws: null,
        createdAt: new Date(ref.createdAt),
        output: [],
        exited: false,
        exitCode: null,
        launchTransport: "tmux",
        tmuxSessionName: ref.tmuxSessionName,
        tmuxAttachCommand: ref.tmuxAttachCommand,
        restoredFromPreserved: true,
        terminate: () => {
          killTmuxSession(
            options.processRuntime.tmuxPath,
            ref.tmuxSessionName,
            options.processRuntime.enrichedPath
          );
        },
        supportsStructuredEvents: false,
        runtimeSequence: 0,
        runtimeSnapshot: null,
        runtimeSubscribers: new Set(),
      },
      {}
    );
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
      supportsStructuredEvents: true,
      runtimeSequence: 0,
      runtimeSnapshot: null,
      runtimeSubscribers: new Set(),
    };

    if (tmuxSessionName) {
      console.log(
        `Session ${input.sessionId} is running in tmux session ${tmuxSessionName} (${session.tmuxAttachCommand})`
      );
    }

    return registerSession(session, input);
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
        restoredFromPreserved: Boolean(session.restoredFromPreserved),
      }));
    },

    async getSessionOutput(sessionId) {
      const active = sessions.get(sessionId);
      if (active) {
        const output = active.restoredFromPreserved
          ? await readConversationTranscript(sessionId).catch(() => stripAnsi(active.output.join("")))
          : stripAnsi(active.output.join(""));
        return {
          sessionId,
          status: active.exited
            ? active.exitCode === 0
              ? "completed"
              : "failed"
            : "running",
          output,
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

    getRuntimeSnapshot(sessionId) {
      const session = sessions.get(sessionId);
      if (!session?.supportsStructuredEvents) {
        return null;
      }

      if (!session.runtimeSnapshot) {
        emitRuntimeSnapshot(session);
      }

      return session.runtimeSnapshot;
    },

    subscribeToRuntimeSnapshots(sessionId, listener) {
      const session = sessions.get(sessionId);
      if (!session?.supportsStructuredEvents) {
        return null;
      }

      session.runtimeSubscribers.add(listener);
      return () => {
        session.runtimeSubscribers.delete(listener);
      };
    },

    getSessionCount() {
      return sessions.size;
    },

    getRestartPlan() {
      return getRestartPlan();
    },

    async restorePreservedSessions() {
      const refs = await consumePreservedTmuxSessions();
      let restoredTmuxSessions = 0;
      let droppedTmuxSessions = 0;

      for (const ref of refs) {
        if (
          !hasTmuxSession(
            options.processRuntime.tmuxPath,
            ref.tmuxSessionName,
            options.processRuntime.enrichedPath
          )
        ) {
          droppedTmuxSessions += 1;
          continue;
        }

        try {
          createAttachedTmuxSession(ref);
          restoredTmuxSessions += 1;
        } catch (error) {
          console.warn(`Failed to restore tmux session ${ref.tmuxSessionName}:`, error);
          droppedTmuxSessions += 1;
        }
      }

      return { restoredTmuxSessions, droppedTmuxSessions };
    },

    terminateAll() {
      for (const [, session] of sessions) {
        session.terminate();
      }
    },

    async shutdown(mode) {
      const plan = getRestartPlan();
      if (mode === "soft" && !plan.softSafe) {
        throw new Error("Soft restart would interrupt active direct sessions.");
      }

      let directSessionsTerminated = 0;
      let tmuxSessionsPreserved = 0;
      let tmuxSessionsTerminated = 0;

      if (mode === "soft") {
        const preserved = buildPreservableTmuxRefs();
        await writePreservedTmuxSessions(preserved);

        clearInterval(completedOutputCleanupInterval);
        clearInterval(exitedSessionCleanupInterval);

        for (const [, session] of sessions) {
          clearSessionTimers(session);
          if (!session.exited && session.launchTransport === "tmux") {
            session.shutdownDisposition = "preserve_tmux";
            if (session.ws && session.ws.readyState === WebSocket.OPEN) {
              session.ws.send(
                "\r\n\x1b[90m[Daemon restarting. tmux session preserved; reconnecting shortly.]\x1b[0m\r\n"
              );
            }
            tmuxSessionsPreserved += 1;
          }
        }
        sessions.clear();
      } else {
        await clearPreservedTmuxSessions();
        clearInterval(completedOutputCleanupInterval);
        clearInterval(exitedSessionCleanupInterval);
        for (const [, session] of sessions) {
          if (!session.exited) {
            if (session.launchTransport === "tmux") {
              tmuxSessionsTerminated += 1;
            } else {
              directSessionsTerminated += 1;
            }
          }
          session.shutdownDisposition = "terminate";
          clearSessionTimers(session);
          session.terminate();
        }
      }

      return {
        mode,
        ...plan,
        directSessionsTerminated,
        tmuxSessionsPreserved,
        tmuxSessionsTerminated,
      };
    },
  };
}
