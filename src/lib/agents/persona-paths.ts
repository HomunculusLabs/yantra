import path from "path";
import { getYantraRoots } from "@/lib/config/yantra-roots";

const { runtimeAgentsRoot } = getYantraRoots();

export const AGENTS_DIR = runtimeAgentsRoot;
export const MEMORY_DIR = path.join(AGENTS_DIR, ".memory");
export const MESSAGES_DIR = path.join(AGENTS_DIR, ".messages");
export const HISTORY_DIR = path.join(AGENTS_DIR, ".history");

export function getPersonaDir(slug: string): string {
  return path.join(AGENTS_DIR, slug);
}

export function getDirectoryPersonaPath(slug: string): string {
  return path.join(getPersonaDir(slug), "persona.md");
}

export function getLegacyPersonaPath(slug: string): string {
  return path.join(AGENTS_DIR, `${slug}.md`);
}

export function getAgentLocalStatsPath(slug: string): string {
  return path.join(getPersonaDir(slug), "memory", "stats.json");
}

export function getLegacyStatsPath(slug: string): string {
  return path.join(MEMORY_DIR, slug, "stats.json");
}

export function getPersonaMemoryDir(slug: string): string {
  return path.join(MEMORY_DIR, slug);
}

export function getPersonaInboxDir(slug: string): string {
  return path.join(MESSAGES_DIR, slug);
}

export function getHeartbeatHistoryPath(slug: string): string {
  return path.join(HISTORY_DIR, `${slug}.jsonl`);
}
