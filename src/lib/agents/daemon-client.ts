import { getDaemonUrl, getOrCreateDaemonToken } from "./daemon-auth";
import type { ResolvedLaunchSpec } from "@/types/launchers";

interface CreateDaemonSessionInput {
  id: string;
  prompt: string;
  launch: ResolvedLaunchSpec;
  timeoutSeconds?: number;
}

interface DaemonFetchOptions extends RequestInit {
  timeoutMs?: number;
}

export interface DaemonSessionHandle {
  sessionId: string;
  launchTransport: "direct" | "tmux";
  tmuxSessionName: string | null;
  tmuxAttachCommand: string | null;
}

async function daemonFetch(path: string, init?: DaemonFetchOptions): Promise<Response> {
  const token = await getOrCreateDaemonToken();
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);

  const controller = new AbortController();
  const signal = init?.signal ?? controller.signal;
  const timeoutMs = init?.timeoutMs ?? 5000;
  const timeout = setTimeout(() => {
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
    clearTimeout(timeout);
  }
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
