import {
  ensureDirectory,
  fileExists,
  readFileContent,
  writeFileContent,
} from "@/lib/storage/fs-operations";
import type { HeartbeatRecord } from "@/types/personas";
import {
  HISTORY_DIR,
  getAgentLocalStatsPath,
  getHeartbeatHistoryPath,
  getLegacyStatsPath,
  getPersonaMemoryDir,
} from "./persona-paths";

const runningHeartbeats = new Set<string>();

export function markHeartbeatRunning(slug: string): void {
  runningHeartbeats.add(slug);
}

export function markHeartbeatComplete(slug: string): void {
  runningHeartbeats.delete(slug);
}

export function getRunningHeartbeats(): string[] {
  return Array.from(runningHeartbeats);
}

export async function readHeartbeatStats(slug: string): Promise<Record<string, unknown> | null> {
  const statsPaths = [getAgentLocalStatsPath(slug), getLegacyStatsPath(slug)];

  for (const statsPath of statsPaths) {
    if (!(await fileExists(statsPath))) continue;
    try {
      return JSON.parse(await readFileContent(statsPath)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  return null;
}

export async function recordHeartbeat(record: HeartbeatRecord): Promise<void> {
  const historyFile = getHeartbeatHistoryPath(record.agentSlug);
  const line = `${JSON.stringify(record)}\n`;
  const fs = await import("fs/promises");
  await fs.appendFile(historyFile, line).catch(async () => {
    await ensureDirectory(HISTORY_DIR);
    await fs.writeFile(historyFile, line);
  });

  const memoryDir = getPersonaMemoryDir(record.agentSlug);
  await ensureDirectory(memoryDir);
  const statsPath = getLegacyStatsPath(record.agentSlug);
  let stats = { heartbeatsUsed: 0, lastHeartbeat: "" };
  if (await fileExists(statsPath)) {
    try {
      stats = JSON.parse(await readFileContent(statsPath));
    } catch {
      // ignore malformed stats and overwrite with a fresh object
    }
  }
  stats.heartbeatsUsed++;
  stats.lastHeartbeat = record.timestamp;
  await writeFileContent(statsPath, JSON.stringify(stats, null, 2));
}

export async function getHeartbeatHistory(slug: string, limit = 20): Promise<HeartbeatRecord[]> {
  const historyFile = getHeartbeatHistoryPath(slug);
  if (!(await fileExists(historyFile))) return [];

  const raw = await readFileContent(historyFile);
  const lines = raw.trim().split("\n").filter(Boolean);
  return lines
    .map((line) => {
      try {
        return JSON.parse(line) as HeartbeatRecord;
      } catch {
        return null;
      }
    })
    .filter((record): record is HeartbeatRecord => Boolean(record))
    .reverse()
    .slice(0, limit);
}
