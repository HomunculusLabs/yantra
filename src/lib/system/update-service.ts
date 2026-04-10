import { getYantraAppPaths } from "@/lib/config/app-paths";
import { getYantraRoots } from "@/lib/config/yantra-roots";
import { getBackupRoot } from "@/lib/system/backup";
import {
  fetchLatestReleaseManifest,
  readBundledReleaseManifest,
} from "@/lib/system/release-manifest";
import { readUpdateStatus } from "@/lib/system/update-status";
import type { UpdateCheckResult } from "@/types/system";

function compareVersions(a: string, b: string): number {
  const left = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const right = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const lhs = left[index] ?? 0;
    const rhs = right[index] ?? 0;
    if (lhs > rhs) return 1;
    if (lhs < rhs) return -1;
  }
  return 0;
}

export async function getUpdateCheckResult(): Promise<UpdateCheckResult> {
  const [current, latestResult, updateStatus] = await Promise.all([
    readBundledReleaseManifest(),
    fetchLatestReleaseManifest(),
    readUpdateStatus(),
  ]);

  const latest = latestResult.manifest;
  const updateAvailable =
    latest != null && compareVersions(latest.version, current.version) > 0;
  const desktopSupported = getYantraAppPaths().mode === "desktop";

  const instructions: string[] = [];
  if (!desktopSupported) {
    instructions.push(
      "Yantra update actions are only available from the desktop shell right now."
    );
  }
  if (!latestResult.manifestUrl) {
    instructions.push(
      "No release manifest URL is configured yet. Set YANTRA_RELEASE_MANIFEST_URL to enable remote checks."
    );
  }
  if (latestResult.manifestUrl && !updateAvailable) {
    instructions.push("This install is already on the latest release manifest Yantra can see.");
  }
  if (updateAvailable) {
    instructions.push(
      "Create a backup of your vault before installing desktop updates."
    );
    instructions.push(
      "Yantra's auto-apply updater is not wired yet in this fork, so use the release notes and backup flow for now."
    );
  }

  const roots = getYantraRoots();

  return {
    current,
    latest,
    manifestUrl: latestResult.manifestUrl,
    updateAvailable,
    canApplyUpdate: false,
    dataDir: roots.vaultRoot,
    runtimeDir: roots.runtimeRoot,
    backupRoot: getBackupRoot(),
    instructions,
    latestReleaseNotesUrl: latest?.releaseNotesUrl,
    updateStatus: {
      ...updateStatus,
      currentVersion: current.version,
      ...(latest ? { targetVersion: latest.version } : {}),
      state:
        latest && updateAvailable
          ? "available"
          : updateStatus.state === "error"
            ? "error"
            : "up-to-date",
    },
    desktopSupported,
  };
}
