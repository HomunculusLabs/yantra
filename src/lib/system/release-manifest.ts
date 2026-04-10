import fs from "fs/promises";
import path from "path";
import { getYantraAppPaths } from "@/lib/config/app-paths";
import type { ReleaseManifest } from "@/types/system";

interface PackageManifest {
  version?: string;
  repository?: string | { url?: string };
}

const DEFAULT_REPOSITORY_URL = "https://github.com/HomunculusLabs/yantra";
const DEFAULT_RELEASE_MANIFEST_URL =
  "https://github.com/HomunculusLabs/yantra/releases/latest/download/yantra-release.json";

function resolveRepositoryUrl(pkg: PackageManifest): string {
  if (typeof pkg.repository === "string" && pkg.repository.trim()) {
    return pkg.repository.replace(/^git\+/, "").replace(/\.git$/, "");
  }
  if (
    pkg.repository &&
    typeof pkg.repository === "object" &&
    typeof pkg.repository.url === "string" &&
    pkg.repository.url.trim()
  ) {
    return pkg.repository.url.replace(/^git\+/, "").replace(/\.git$/, "");
  }
  return DEFAULT_REPOSITORY_URL;
}

async function readPackageManifest(): Promise<PackageManifest> {
  const raw = await fs.readFile(
    path.join(getYantraAppPaths().projectRoot, "package.json"),
    "utf-8"
  );
  return JSON.parse(raw) as PackageManifest;
}

function buildFallbackManifest(pkg: PackageManifest): ReleaseManifest {
  const version = pkg.version || "0.0.0";
  const gitTag = `v${version}`;
  const repositoryUrl = resolveRepositoryUrl(pkg);
  return {
    manifestVersion: 1,
    version,
    channel: "stable",
    releaseDate: new Date(0).toISOString(),
    gitTag,
    repositoryUrl,
    releaseNotesUrl: `${repositoryUrl}/releases/tag/${gitTag}`,
    sourceTarballUrl: `${repositoryUrl}/archive/refs/tags/${gitTag}.tar.gz`,
  };
}

function getReleaseManifestUrl(): string | null {
  const configured = process.env.YANTRA_RELEASE_MANIFEST_URL?.trim();
  if (configured) return configured;
  return DEFAULT_RELEASE_MANIFEST_URL;
}

export async function readBundledReleaseManifest(): Promise<ReleaseManifest> {
  return buildFallbackManifest(await readPackageManifest());
}

export async function fetchLatestReleaseManifest(): Promise<{
  manifest: ReleaseManifest | null;
  manifestUrl: string | null;
  source: "remote" | "bundled";
}> {
  const manifestUrl = getReleaseManifestUrl();
  const bundled = await readBundledReleaseManifest();

  if (!manifestUrl) {
    return {
      manifest: bundled,
      manifestUrl: null,
      source: "bundled",
    };
  }

  try {
    const response = await fetch(manifestUrl, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Manifest request failed (${response.status})`);
    }

    const next = (await response.json()) as Partial<ReleaseManifest>;
    return {
      manifest: {
        ...bundled,
        ...next,
      },
      manifestUrl,
      source: "remote",
    };
  } catch {
    return {
      manifest: bundled,
      manifestUrl,
      source: "bundled",
    };
  }
}
