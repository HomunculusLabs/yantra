import fs from "fs";
import path from "path";
import { execFileSync, execSync } from "child_process";
import type { ResolvedLaunchSpec } from "../src/types/launchers";

export interface DaemonProcessRuntime {
  claudePath: string;
  tmuxPath: string;
  tmuxAvailable: boolean;
  enrichedPath: string;
}

export function resolveBinaryPath(
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

export function resolveDaemonProcessRuntime(): DaemonProcessRuntime {
  const claudePath = resolveBinaryPath("claude", [
    path.join(process.env.HOME || "", ".local", "bin", "claude"),
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
  ]);

  const tmuxPath = resolveBinaryPath("tmux", [
    "/usr/bin/tmux",
    "/bin/tmux",
    "/usr/local/bin/tmux",
    "/opt/homebrew/bin/tmux",
  ]);

  const enrichedPath = [
    `${process.env.HOME}/.local/bin`,
    process.env.PATH,
  ].join(":");

  const tmuxAvailable = (() => {
    try {
      execFileSync(tmuxPath, ["-V"], {
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

  return {
    claudePath,
    tmuxPath,
    tmuxAvailable,
    enrichedPath,
  };
}

export function buildTmuxSessionName(sessionId: string): string {
  const sanitized = sessionId
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return `yantra-${sanitized || Date.now()}`;
}

export function buildTmuxAttachCommand(tmuxPath: string, sessionName: string): string {
  return `${tmuxPath} attach -t ${sessionName}`;
}

export function killTmuxSession(
  tmuxPath: string,
  sessionName: string,
  enrichedPath: string
): void {
  try {
    execFileSync(tmuxPath, ["kill-session", "-t", sessionName], {
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

export function buildTmuxSpawnArgs(
  launch: ResolvedLaunchSpec,
  sessionName: string,
  enrichedPath: string
): string[] {
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

export function stripAnsi(str: string): string {
  return str.replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    ""
  );
}

export function claudePromptReady(output: string): boolean {
  const plain = stripAnsi(output).replace(/\r/g, "\n");
  return (
    plain.includes("shift+tab to cycle") ||
    /(?:^|\n)[❯>]\s*$/.test(plain)
  );
}
