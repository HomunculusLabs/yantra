import matter from "gray-matter";
import cron from "node-cron";
import {
  readFileContent,
  writeFileContent,
  fileExists,
  ensureDirectory,
  listDirectory,
} from "@/lib/storage/fs-operations";
import type { AgentPersona } from "@/types/personas";
import { runHeartbeat } from "./heartbeat";
import { getGoalState } from "./goal-manager";
import {
  AGENTS_DIR,
  HISTORY_DIR,
  MEMORY_DIR,
  MESSAGES_DIR,
  getDirectoryPersonaPath,
  getLegacyPersonaPath,
  getPersonaDir,
} from "./persona-paths";
import { readHeartbeatStats } from "./persona-runtime-state";

export type { AgentPersona, HeartbeatRecord } from "@/types/personas";
export { readMemory, writeMemory, listMemoryFiles } from "./persona-memory-store";
export { sendMessage, readInbox, clearInbox } from "./persona-message-store";
export {
  recordHeartbeat,
  getHeartbeatHistory,
  markHeartbeatRunning,
  markHeartbeatComplete,
  getRunningHeartbeats,
} from "./persona-runtime-state";

/**
 * Compute the next run time from a cron expression after a given date.
 * Simple approach: iterate minute-by-minute from `after` until we find a match.
 * Handles standard 5-field cron (minute, hour, dom, month, dow).
 */
function computeNextCronRun(cronExpr: string, after: Date): Date | null {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length < 5) return null;

  const parseField = (field: string, max: number): number[] | null => {
    if (field === "*") return null;
    const values: number[] = [];
    for (const part of field.split(",")) {
      const stepMatch = part.match(/^(\*|\d+(?:-\d+)?)\/(\d+)$/);
      if (stepMatch) {
        const step = parseInt(stepMatch[2]);
        const rangeMatch = stepMatch[1].match(/^(\d+)-(\d+)$/);
        const start = stepMatch[1] === "*" ? 0 : rangeMatch ? parseInt(rangeMatch[1]) : parseInt(stepMatch[1]);
        const end = rangeMatch ? parseInt(rangeMatch[2]) : max;
        for (let index = start; index <= end; index += step) values.push(index);
      } else {
        const rangeMatch = part.match(/^(\d+)-(\d+)$/);
        if (rangeMatch) {
          for (let index = parseInt(rangeMatch[1]); index <= parseInt(rangeMatch[2]); index++) {
            values.push(index);
          }
        } else {
          values.push(parseInt(part));
        }
      }
    }
    return values;
  };

  const minutes = parseField(parts[0], 59);
  const hours = parseField(parts[1], 23);
  const doms = parseField(parts[2], 31);
  const months = parseField(parts[3], 12);
  const dows = parseField(parts[4], 6);

  const matches = (date: Date) => {
    if (minutes && !minutes.includes(date.getMinutes())) return false;
    if (hours && !hours.includes(date.getHours())) return false;
    if (doms && !doms.includes(date.getDate())) return false;
    if (months && !months.includes(date.getMonth() + 1)) return false;
    if (dows && !dows.includes(date.getDay())) return false;
    return true;
  };

  const candidate = new Date(after);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  const limit = after.getTime() + 7 * 24 * 60 * 60 * 1000;
  while (candidate.getTime() < limit) {
    if (matches(candidate)) return candidate;
    candidate.setMinutes(candidate.getMinutes() + 1);
  }
  return null;
}

const heartbeatJobs = new Map<string, ReturnType<typeof cron.schedule>>();

function slugFromFilename(filename: string): string {
  return filename.replace(/\.md$/, "");
}

export async function initAgentsDir(): Promise<void> {
  await ensureDirectory(AGENTS_DIR);
  await ensureDirectory(MEMORY_DIR);
  await ensureDirectory(MESSAGES_DIR);
  await ensureDirectory(HISTORY_DIR);
}

export async function listPersonas(): Promise<AgentPersona[]> {
  await initAgentsDir();
  const entries = await listDirectory(AGENTS_DIR);
  const personas: AgentPersona[] = [];

  for (const entry of entries) {
    if (entry.isDirectory && !entry.name.startsWith(".")) {
      const personaPath = getDirectoryPersonaPath(entry.name);
      if (await fileExists(personaPath)) {
        const persona = await readPersona(entry.name);
        if (persona && persona.role) personas.push(persona);
      }
      continue;
    }

    if (!entry.name.endsWith(".md") || entry.isDirectory) continue;
    const persona = await readPersona(slugFromFilename(entry.name));
    if (persona && persona.role) personas.push(persona);
  }

  return personas;
}

export async function readPersona(slug: string): Promise<AgentPersona | null> {
  let filePath = getDirectoryPersonaPath(slug);
  if (!(await fileExists(filePath))) {
    filePath = getLegacyPersonaPath(slug);
    if (!(await fileExists(filePath))) return null;
  }

  const raw = await readFileContent(filePath);
  const { data, content } = matter(raw);

  const persona: AgentPersona = {
    name: (data.name as string) || slug,
    role: (data.role as string) || "",
    provider: (data.provider as string) || "claude-code",
    heartbeat: (data.heartbeat as string) || "0 8 * * *",
    budget: (data.budget as number) || 100,
    active: data.active !== false,
    workdir: (data.workdir as string) || "/data",
    focus: (data.focus as string[]) || [],
    tags: (data.tags as string[]) || [],
    emoji: (data.emoji as string) || "",
    department: (data.department as string) || "general",
    type: (data.type as AgentPersona["type"]) || "specialist",
    goals: (data.goals as AgentPersona["goals"]) || [],
    channels: (data.channels as string[]) || ["general"],
    workspace: (data.workspace as string) || "workspace",
    output_dir: typeof data.output_dir === "string" ? data.output_dir : undefined,
    launcher: data.launcher as AgentPersona["launcher"],
    slug,
    body: content.trim(),
  };

  const stats = await readHeartbeatStats(slug);
  if (stats) {
    persona.heartbeatsUsed = (stats.heartbeatsUsed as number) || 0;
    persona.lastHeartbeat = typeof stats.lastHeartbeat === "string" ? stats.lastHeartbeat : undefined;
  }

  if (persona.active && persona.heartbeat && persona.lastHeartbeat) {
    try {
      const nextRun = computeNextCronRun(persona.heartbeat, new Date(persona.lastHeartbeat));
      if (nextRun) persona.nextHeartbeat = nextRun.toISOString();
    } catch {
      // ignore invalid heartbeat preview calculation
    }
  }

  if (persona.goals.length > 0) {
    try {
      const goalState = await getGoalState(slug);
      persona.goals = persona.goals.map((goal) => {
        const state = goalState[goal.metric];
        return state ? { ...goal, current: state.current } : goal;
      });
    } catch {
      // ignore goal state overlay failures
    }
  }

  return persona;
}

export async function writePersona(slug: string, persona: Partial<AgentPersona> & { body?: string }): Promise<void> {
  await initAgentsDir();
  const agentDir = getPersonaDir(slug);
  await ensureDirectory(agentDir);
  const filePath = getDirectoryPersonaPath(slug);

  const existing = await readPersona(slug);
  const merged = { ...(existing ?? {}), ...persona } as Partial<AgentPersona> & { body?: string };

  const frontmatter: Record<string, unknown> = {
    name: merged.name,
    role: merged.role,
    provider: merged.provider,
    heartbeat: merged.heartbeat,
    budget: merged.budget,
    active: merged.active,
    workdir: merged.workdir,
    focus: merged.focus,
    tags: merged.tags,
    emoji: merged.emoji || "",
    department: merged.department || "general",
    type: merged.type || "specialist",
    workspace: merged.workspace || "workspace",
    ...(merged.output_dir ? { output_dir: merged.output_dir } : {}),
    ...(merged.launcher ? { launcher: merged.launcher } : {}),
    ...(merged.goals && merged.goals.length > 0 ? { goals: merged.goals } : {}),
    ...(merged.channels && merged.channels.length > 0 ? { channels: merged.channels } : {}),
  };

  const markdown = matter.stringify(merged.body || "", frontmatter);
  await writeFileContent(filePath, markdown);
}

export async function deletePersona(slug: string): Promise<void> {
  const fs = await import("fs/promises");
  const directoryPersonaPath = getDirectoryPersonaPath(slug);

  if (await fileExists(directoryPersonaPath)) {
    await fs.rm(getPersonaDir(slug), { recursive: true, force: true });
  } else {
    await fs.unlink(getLegacyPersonaPath(slug)).catch(() => {});
  }

  unregisterHeartbeat(slug);
}

export function registerHeartbeat(slug: string, cronExpr: string): void {
  unregisterHeartbeat(slug);
  if (!cron.validate(cronExpr)) return;

  const job = cron.schedule(cronExpr, () => {
    runHeartbeat(slug).catch((error) => {
      console.error(`Heartbeat failed for ${slug}:`, error);
    });
  });

  heartbeatJobs.set(slug, job);
}

export function unregisterHeartbeat(slug: string): void {
  const existing = heartbeatJobs.get(slug);
  if (existing) {
    existing.stop();
    heartbeatJobs.delete(slug);
  }
}

export async function registerAllHeartbeats(): Promise<void> {
  const personas = await listPersonas();
  for (const persona of personas) {
    if (persona.active && persona.heartbeatsUsed !== undefined && persona.heartbeatsUsed < persona.budget) {
      registerHeartbeat(persona.slug, persona.heartbeat);
    }
  }
}

export function getRegisteredHeartbeats(): string[] {
  return Array.from(heartbeatJobs.keys());
}
