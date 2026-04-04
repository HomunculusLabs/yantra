import { spawn, spawnSync, type ChildProcess } from "child_process";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const TMUX_BIN = process.env.YANTRA_TMUX_BIN?.trim() || "tmux";
const CLAUDE_BIN = process.env.YANTRA_DEFAULT_CLI_COMMAND?.trim() || "claude";
const TMUX_AVAILABLE =
  spawnSync(TMUX_BIN, ["-V"], { stdio: "ignore", env: { ...process.env } }).status === 0;

function buildTmuxSessionName(sessionId: string): string {
  const sanitized = sessionId
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return `yantra-${sanitized || Date.now()}`;
}

function killTmuxSession(sessionName: string): void {
  spawnSync(TMUX_BIN, ["kill-session", "-t", sessionName], {
    stdio: "ignore",
    env: { ...process.env },
  });
}

export interface AgentSession {
  id: string;
  taskId?: string;
  taskTitle: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt?: string;
  output: string;
  process?: ChildProcess;
  launchTransport: "direct" | "tmux";
  tmuxSessionName?: string;
  tmuxAttachCommand?: string;
}

// In-memory session store
const sessions = new Map<string, AgentSession>();

export function getActiveSessions(): AgentSession[] {
  return Array.from(sessions.values())
    .filter((s) => s.status === "running")
    .map(({ process: _p, ...rest }) => rest);
}

export function getRecentSessions(limit = 10): AgentSession[] {
  return Array.from(sessions.values())
    .filter((s) => s.status !== "running")
    .sort(
      (a, b) =>
        new Date(b.completedAt || b.startedAt).getTime() -
        new Date(a.completedAt || a.startedAt).getTime()
    )
    .slice(0, limit)
    .map(({ process: _p, ...rest }) => rest);
}

export function getSession(id: string): AgentSession | undefined {
  const session = sessions.get(id);
  if (!session) return undefined;
  const { process: _p, ...rest } = session;
  return rest;
}

export function getAgentStats(): {
  active: number;
  completed: number;
  failed: number;
  totalRuns: number;
} {
  let active = 0;
  let completed = 0;
  let failed = 0;

  for (const session of sessions.values()) {
    if (session.status === "running") active++;
    else if (session.status === "completed") completed++;
    else if (session.status === "failed") failed++;
  }

  return { active, completed, failed, totalRuns: sessions.size };
}

export async function runAgent(
  taskTitle: string,
  prompt: string,
  taskId?: string,
  workdir?: string
): Promise<string> {
  const id = `agent-${Date.now()}`;
  const cwd = workdir ? path.join(DATA_DIR, workdir) : DATA_DIR;
  const tmuxSessionName = TMUX_AVAILABLE ? buildTmuxSessionName(id) : undefined;

  const session: AgentSession = {
    id,
    taskId,
    taskTitle,
    status: "running",
    startedAt: new Date().toISOString(),
    output: "",
    launchTransport: tmuxSessionName ? "tmux" : "direct",
    tmuxSessionName,
    tmuxAttachCommand: tmuxSessionName ? `${TMUX_BIN} attach -t ${tmuxSessionName}` : undefined,
  };

  const proc = tmuxSessionName
    ? spawn(
        TMUX_BIN,
        [
          "new-session",
          "-A",
          "-s",
          tmuxSessionName,
          "-c",
          cwd,
          CLAUDE_BIN,
          "--dangerously-skip-permissions",
          "-p",
          prompt,
          "--output-format",
          "text",
        ],
        {
          cwd,
          env: { ...process.env },
          stdio: ["pipe", "pipe", "pipe"],
        }
      )
    : spawn(
        CLAUDE_BIN,
        ["--dangerously-skip-permissions", "-p", prompt, "--output-format", "text"],
        {
          cwd,
          env: { ...process.env },
          stdio: ["pipe", "pipe", "pipe"],
        }
      );

  session.process = proc;
  sessions.set(id, session);

  proc.stdout?.on("data", (data: Buffer) => {
    session.output += data.toString();
  });

  proc.stderr?.on("data", (data: Buffer) => {
    session.output += data.toString();
  });

  proc.on("close", (code: number | null) => {
    session.status = code === 0 ? "completed" : "failed";
    session.completedAt = new Date().toISOString();
    delete session.process;

    if (code === 0 && taskId) {
      autoSummarize(session).catch(() => {});
    }
  });

  proc.on("error", (error) => {
    session.status = "failed";
    session.completedAt = new Date().toISOString();
    session.output += `\n${error.message}\n`;
    delete session.process;
  });

  return id;
}

async function autoSummarize(session: AgentSession): Promise<void> {
  try {
    const diffProc = spawn("git", ["diff", "HEAD~1", "--stat"], {
      cwd: DATA_DIR,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let diffOutput = "";
    diffProc.stdout?.on("data", (d: Buffer) => { diffOutput += d.toString(); });
    await new Promise<void>((resolve) => diffProc.on("close", () => resolve()));

    if (diffOutput.trim()) {
      session.output += `\n\n--- Auto-Summary ---\nFiles changed:\n${diffOutput}`;
    }
  } catch {
    // ignore summarize errors
  }
}

export function stopAgent(id: string): boolean {
  const session = sessions.get(id);
  if (!session || !session.process) return false;

  if (session.tmuxSessionName) {
    killTmuxSession(session.tmuxSessionName);
  }
  try {
    session.process.kill();
  } catch {
    // ignore
  }

  session.status = "failed";
  session.completedAt = new Date().toISOString();
  delete session.process;
  return true;
}
