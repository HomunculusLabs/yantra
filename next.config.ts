import fs from "fs";
import path from "path";
import type { NextConfig } from "next";

interface RootsConfigFile {
  runtimeRoot?: string;
}

function normalizeRoot(projectRoot: string, value: string): string {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(projectRoot, value);
}

function toWatchGlob(projectRoot: string, candidatePath: string, recursive = true): string {
  const relative = path.relative(projectRoot, path.resolve(candidatePath)).split(path.sep).join("/");
  if (!relative || relative.startsWith("..")) {
    return "";
  }
  return recursive ? `**/${relative}/**` : `**/${relative}`;
}

function readRuntimeRoot(projectRoot: string): string {
  const configRoot = path.resolve(process.env.YANTRA_APP_CONFIG_DIR?.trim() || projectRoot);
  const rootsConfigPath = path.resolve(
    process.env.YANTRA_ROOTS_CONFIG_PATH?.trim() || path.join(configRoot, "yantra-roots.json")
  );
  const defaultRuntimeRoot = normalizeRoot(
    projectRoot,
    process.env.YANTRA_DEFAULT_RUNTIME_ROOT?.trim() || "data"
  );

  let configuredRuntimeRoot: string | null = null;
  try {
    const raw = fs.readFileSync(rootsConfigPath, "utf-8");
    const parsed = JSON.parse(raw) as RootsConfigFile;
    configuredRuntimeRoot = parsed.runtimeRoot?.trim() || null;
  } catch {
    configuredRuntimeRoot = null;
  }

  return normalizeRoot(
    projectRoot,
    process.env.YANTRA_RUNTIME_ROOT?.trim() || configuredRuntimeRoot || defaultRuntimeRoot
  );
}

function isProjectDescendant(projectRoot: string, candidatePath: string): boolean {
  const normalizedProjectRoot = path.resolve(projectRoot);
  const normalizedCandidate = path.resolve(candidatePath);
  return (
    normalizedCandidate !== normalizedProjectRoot &&
    normalizedCandidate.startsWith(`${normalizedProjectRoot}${path.sep}`)
  );
}

function buildRuntimeWatchIgnoreGlobs(projectRoot: string, runtimeRoot: string): string[] {
  const runtimeCandidates = [
    path.join(runtimeRoot, ".agents", ".config"),
    path.join(runtimeRoot, ".agents", ".conversations"),
    path.join(runtimeRoot, ".agents", ".history"),
    path.join(runtimeRoot, ".agents", ".memory"),
    path.join(runtimeRoot, ".agents", ".messages"),
    path.join(runtimeRoot, ".agents", ".runtime"),
    path.join(runtimeRoot, ".agents", ".slack"),
    path.join(runtimeRoot, ".chat"),
    path.join(runtimeRoot, ".jobs", ".history"),
  ];

  const fileCandidates = [
    path.join(runtimeRoot, ".yantra.db"),
    path.join(runtimeRoot, ".yantra.db-shm"),
    path.join(runtimeRoot, ".yantra.db-wal"),
  ];

  const directoryGlobs = runtimeCandidates
    .filter((candidatePath, index, all) => all.indexOf(candidatePath) === index)
    .filter((candidatePath) => isProjectDescendant(projectRoot, candidatePath))
    .map((candidatePath) => toWatchGlob(projectRoot, candidatePath, true))
    .filter(Boolean);

  const fileGlobs = fileCandidates
    .filter((candidatePath, index, all) => all.indexOf(candidatePath) === index)
    .filter((candidatePath) => isProjectDescendant(projectRoot, candidatePath))
    .map((candidatePath) => toWatchGlob(projectRoot, candidatePath, false))
    .filter(Boolean);

  const perAgentGlobs = isProjectDescendant(projectRoot, runtimeRoot)
    ? [
        toWatchGlob(projectRoot, path.join(runtimeRoot, ".agents", "*", "workspace"), true),
        toWatchGlob(projectRoot, path.join(runtimeRoot, ".agents", "*", "sessions"), true),
      ].filter(Boolean)
    : [];

  return [...directoryGlobs, ...fileGlobs, ...perAgentGlobs];
}

const projectRoot = path.resolve(__dirname);
const runtimeRoot = readRuntimeRoot(projectRoot);
const runtimeWatchIgnores = buildRuntimeWatchIgnoreGlobs(projectRoot, runtimeRoot);

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["node-pty", "simple-git", "better-sqlite3"],
  turbopack: {
    root: projectRoot,
  },
  webpack: (config) => {
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      tailwindcss$: path.resolve(__dirname, "node_modules/tailwindcss/index.css"),
      "tw-animate-css$": path.resolve(
        __dirname,
        "node_modules/tw-animate-css/dist/tw-animate.css"
      ),
      "shadcn/tailwind.css$": path.resolve(
        __dirname,
        "node_modules/shadcn/dist/tailwind.css"
      ),
    };

    // In Electron dev, live agent/session writes land under the configured runtime root.
    // Ignore those volatile paths so chat transcripts/history don't trigger full renderer reloads.
    if (runtimeWatchIgnores.length > 0) {
      const existingIgnored = config.watchOptions?.ignored;
      const nextIgnored = Array.isArray(existingIgnored)
        ? [...existingIgnored, ...runtimeWatchIgnores]
        : typeof existingIgnored === "string"
          ? [existingIgnored, ...runtimeWatchIgnores]
          : runtimeWatchIgnores;

      config.watchOptions = {
        ...(config.watchOptions || {}),
        ignored: nextIgnored,
      };
    }

    return config;
  },
};

export default nextConfig;
