import { getDaemonUrl, getOrCreateDaemonToken } from "./daemon-auth";
import type { ResolvedLaunchSpec } from "@/types/launchers";
import type {
  ConversationRuntimeEventStreamFormat,
  ConversationRuntimeSnapshot,
} from "@/types/conversations";

interface CreateDaemonSessionInput {
  id: string;
  prompt: string;
  launch: ResolvedLaunchSpec;
  timeoutSeconds?: number;
}

interface DaemonFetchOptions extends RequestInit {
  timeoutMs?: number | null;
}

export interface DaemonSessionHandle {
  sessionId: string;
  launchTransport: "direct" | "tmux";
  tmuxSessionName: string | null;
  tmuxAttachCommand: string | null;
  eventStreamFormat?: ConversationRuntimeEventStreamFormat;
}

export interface DaemonHealth {
  status: string;
  service: string;
  ptySessions: number;
  scheduledJobs: number;
  scheduledHeartbeats: number;
  absurdWorkerReady: boolean;
  tmuxAvailable?: boolean;
  restartPlan?: {
    activeSessionCount: number;
    directSessionCount: number;
    tmuxSessionCount: number;
    restoredTmuxSessionCount: number;
    preservableTmuxSessionCount: number;
    softSafe: boolean;
  };
}

async function daemonFetch(path: string, init?: DaemonFetchOptions): Promise<Response> {
  const token = await getOrCreateDaemonToken();
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);

  const controller = new AbortController();
  const signal = init?.signal ?? controller.signal;
  const timeoutMs = init?.timeoutMs ?? 5000;
  const timeout =
    timeoutMs == null
      ? null
      : setTimeout(() => {
          if (!init?.signal) {
            controller.abort(new Error(`Daemon request timed out after ${timeoutMs}ms`));
          }
        }, timeoutMs);

  try {
    return await fetch(`${getDaemonUrl()}${path}`, {
      ...init,
      headers,
      signal,
    });
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function parseSseChunk(buffer: string): {
  events: { event: string; data: string }[];
  remainder: string;
} {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const frames = normalized.split("\n\n");
  const remainder = frames.pop() ?? "";
  const events = frames
    .map((frame) => {
      let event = "message";
      const dataLines: string[] = [];
      for (const line of frame.split("\n")) {
        if (!line || line.startsWith(":")) continue;
        if (line.startsWith("event:")) {
          event = line.slice("event:".length).trim();
          continue;
        }
        if (line.startsWith("data:")) {
          dataLines.push(line.slice("data:".length).trimStart());
        }
      }

      if (dataLines.length === 0) {
        return null;
      }

      return {
        event,
        data: dataLines.join("\n"),
      };
    })
    .filter(Boolean) as { event: string; data: string }[];

  return { events, remainder };
}

export async function createDaemonSession(
  input: CreateDaemonSessionInput
): Promise<DaemonSessionHandle> {
  const response = await daemonFetch("/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    timeoutMs: 10000,
  });

  if (!response.ok) {
    throw new Error(`Failed to create daemon session (${response.status})`);
  }

  return response.json() as Promise<DaemonSessionHandle>;
}

export async function getDaemonSessionOutput(
  id: string,
  options?: { timeoutMs?: number }
): Promise<{
  status: string;
  output: string;
}> {
  const response = await daemonFetch(`/session/${encodeURIComponent(id)}/output`, {
    timeoutMs: options?.timeoutMs,
  });
  if (!response.ok) {
    throw new Error(`Failed to load daemon session output (${response.status})`);
  }
  return response.json() as Promise<{ status: string; output: string }>;
}

export async function getDaemonSessionRuntimeSnapshot(
  id: string,
  options?: { timeoutMs?: number }
): Promise<ConversationRuntimeSnapshot> {
  const response = await daemonFetch(`/session/${encodeURIComponent(id)}/runtime`, {
    timeoutMs: options?.timeoutMs,
  });
  if (!response.ok) {
    throw new Error(`Failed to load daemon session runtime snapshot (${response.status})`);
  }
  return response.json() as Promise<ConversationRuntimeSnapshot>;
}

export async function* streamDaemonSessionRuntimeSnapshots(
  id: string,
  options?: { signal?: AbortSignal; timeoutMs?: number | null }
): AsyncGenerator<ConversationRuntimeSnapshot, void, void> {
  const response = await daemonFetch(`/session/${encodeURIComponent(id)}/events`, {
    signal: options?.signal,
    timeoutMs: options?.timeoutMs ?? null,
  });

  if (!response.ok) {
    throw new Error(`Failed to stream daemon session runtime snapshots (${response.status})`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Daemon runtime snapshot stream did not include a readable body");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseChunk(buffer);
    buffer = parsed.remainder;

    for (const event of parsed.events) {
      if (event.event !== "runtime_snapshot") {
        continue;
      }
      yield JSON.parse(event.data) as ConversationRuntimeSnapshot;
    }
  }

  buffer += decoder.decode();
  const parsed = parseSseChunk(buffer);
  for (const event of parsed.events) {
    if (event.event !== "runtime_snapshot") {
      continue;
    }
    yield JSON.parse(event.data) as ConversationRuntimeSnapshot;
  }
}

export async function listDaemonSessions(options?: { timeoutMs?: number }): Promise<
  {
    id: string;
    createdAt: string;
    connected: boolean;
    exited: boolean;
    exitCode: number | null;
    launchTransport: "direct" | "tmux";
    tmuxSessionName: string | null;
    tmuxAttachCommand: string | null;
  }[]
> {
  const response = await daemonFetch("/sessions", {
    timeoutMs: options?.timeoutMs,
  });
  if (!response.ok) {
    throw new Error(`Failed to list daemon sessions (${response.status})`);
  }
  return response.json() as Promise<
    {
      id: string;
      createdAt: string;
      connected: boolean;
      exited: boolean;
      exitCode: number | null;
      launchTransport: "direct" | "tmux";
      tmuxSessionName: string | null;
      tmuxAttachCommand: string | null;
    }[]
  >;
}

export async function getDaemonHealth(options?: {
  timeoutMs?: number;
}): Promise<DaemonHealth> {
  const response = await daemonFetch("/health", {
    timeoutMs: options?.timeoutMs,
  });
  if (!response.ok) {
    throw new Error(`Failed to load daemon health (${response.status})`);
  }
  return response.json() as Promise<DaemonHealth>;
}

export async function reloadDaemonSchedules(options?: {
  timeoutMs?: number;
}): Promise<void> {
  const response = await daemonFetch("/reload-schedules", {
    method: "POST",
    timeoutMs: options?.timeoutMs,
  });

  if (!response.ok) {
    throw new Error(`Failed to reload daemon schedules (${response.status})`);
  }
}
