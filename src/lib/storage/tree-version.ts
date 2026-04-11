import fs from "fs/promises";
import { getYantraRoots } from "@/lib/config/yantra-roots";
import { DATA_DIR } from "@/lib/storage/path-utils";

const TREE_VERSION_CACHE_TTL_MS = 500;

let cachedTreeVersion: { value: string; expiresAt: number } | null = null;
let inFlightTreeVersion: Promise<string> | null = null;

async function computeTreeVersion(): Promise<string> {
  try {
    const stat = await fs.stat(DATA_DIR);
    const entries = await fs.readdir(DATA_DIR, { recursive: false });
    const { runtimeAgentsRoot } = getYantraRoots();

    // Also watch .agents so agent add/remove triggers a refresh.
    let agentsSig = "";
    try {
      const agentStat = await fs.stat(runtimeAgentsRoot);
      const agentEntries = await fs.readdir(runtimeAgentsRoot);
      agentsSig = `${agentStat.mtimeMs}-${agentEntries.length}`;
    } catch {
      /* ignore if .agents doesn't exist yet */
    }

    return `${stat.mtimeMs}-${entries.length}-${agentsSig}`;
  } catch {
    return "0";
  }
}

/**
 * Lightweight signature for coarse tree-shape changes.
 *
 * This intentionally avoids walking the full vault. It is used for burst
 * coalescing and tree-change SSE polling; explicit tree fetches still rebuild
 * when the short in-process cache expires.
 */
export async function getTreeVersion(): Promise<string> {
  const now = Date.now();
  if (cachedTreeVersion && cachedTreeVersion.expiresAt > now) {
    return cachedTreeVersion.value;
  }

  if (inFlightTreeVersion) return inFlightTreeVersion;

  inFlightTreeVersion = computeTreeVersion()
    .then((value) => {
      cachedTreeVersion = {
        value,
        expiresAt: Date.now() + TREE_VERSION_CACHE_TTL_MS,
      };
      return value;
    })
    .finally(() => {
      inFlightTreeVersion = null;
    });

  return inFlightTreeVersion;
}
