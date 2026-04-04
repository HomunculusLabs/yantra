import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { getYantraAppPaths } from "@/lib/config/app-paths";

export interface YantraRoots {
  vaultRoot: string;
  runtimeRoot: string;
  runtimeAgentsRoot: string;
  runtimeJobsRoot: string;
  runtimeConfigRoot: string;
  runtimeDaemonRoot: string;
  databasePath: string;
}

export interface YantraRootsConfigFile {
  vaultRoot?: string;
  runtimeRoot?: string;
}

let cachedRoots: YantraRoots | null = null;

function normalizeRoot(input: string): string {
  return path.resolve(input);
}

function resolveDefaultRoot(rawValue: string | undefined, fallback: string): string {
  const value = rawValue?.trim() || fallback;
  return path.isAbsolute(value)
    ? normalizeRoot(value)
    : normalizeRoot(path.join(getYantraAppPaths().projectRoot, value));
}

function defaultVaultRoot(): string {
  return resolveDefaultRoot(process.env.YANTRA_DEFAULT_VAULT_ROOT, "data");
}

function defaultRuntimeRoot(): string {
  return resolveDefaultRoot(process.env.YANTRA_DEFAULT_RUNTIME_ROOT, "data");
}

export function getYantraRootsConfigPath(): string {
  return getYantraAppPaths().rootsConfigPath;
}

export function clearYantraRootsCache(): void {
  cachedRoots = null;
}

export function readYantraRootsConfig(): YantraRootsConfigFile {
  try {
    const raw = fs.readFileSync(getYantraRootsConfigPath(), "utf-8");
    const parsed = JSON.parse(raw) as YantraRootsConfigFile;
    return {
      ...(parsed.vaultRoot?.trim() ? { vaultRoot: parsed.vaultRoot.trim() } : {}),
      ...(parsed.runtimeRoot?.trim() ? { runtimeRoot: parsed.runtimeRoot.trim() } : {}),
    };
  } catch {
    return {};
  }
}

export async function saveYantraRootsConfig(
  config: YantraRootsConfigFile
): Promise<YantraRootsConfigFile> {
  const configPath = getYantraRootsConfigPath();
  const next: YantraRootsConfigFile = {
    vaultRoot: normalizeRoot(config.vaultRoot?.trim() || defaultVaultRoot()),
    runtimeRoot: normalizeRoot(config.runtimeRoot?.trim() || defaultRuntimeRoot()),
  };

  await fsp.mkdir(path.dirname(configPath), { recursive: true });
  await fsp.writeFile(
    configPath,
    `${JSON.stringify(next, null, 2)}\n`,
    "utf-8"
  );
  return next;
}

export function getYantraRoots(): YantraRoots {
  if (cachedRoots) return cachedRoots;

  const config = readYantraRootsConfig();
  const vaultRoot = normalizeRoot(
    process.env.YANTRA_VAULT_ROOT?.trim() ||
      config.vaultRoot?.trim() ||
      defaultVaultRoot()
  );
  const runtimeRoot = normalizeRoot(
    process.env.YANTRA_RUNTIME_ROOT?.trim() ||
      config.runtimeRoot?.trim() ||
      defaultRuntimeRoot()
  );

  cachedRoots = {
    vaultRoot,
    runtimeRoot,
    runtimeAgentsRoot: path.join(runtimeRoot, ".agents"),
    runtimeJobsRoot: path.join(runtimeRoot, ".jobs"),
    runtimeConfigRoot: path.join(runtimeRoot, ".agents", ".config"),
    runtimeDaemonRoot: path.join(runtimeRoot, ".agents", ".runtime"),
    databasePath: path.join(runtimeRoot, ".yantra.db"),
  };

  return cachedRoots;
}

function assertInsideRoot(absPath: string, root: string, label: string): string {
  const normalizedRoot = path.resolve(root);
  const normalizedPath = path.resolve(absPath);

  if (
    normalizedPath !== normalizedRoot &&
    !normalizedPath.startsWith(`${normalizedRoot}${path.sep}`)
  ) {
    throw new Error(`Path escapes ${label} root`);
  }

  return normalizedPath;
}

export function ensureVaultRootExists(): string {
  const { vaultRoot } = getYantraRoots();
  if (!fs.existsSync(vaultRoot)) {
    fs.mkdirSync(vaultRoot, { recursive: true });
  }
  return vaultRoot;
}

export function ensureRuntimeRootExists(): string {
  const { runtimeRoot } = getYantraRoots();
  fs.mkdirSync(runtimeRoot, { recursive: true });
  return runtimeRoot;
}

export function resolveVaultPath(relativeOrAbsolute = ""): string {
  const { vaultRoot } = getYantraRoots();
  const candidate = path.isAbsolute(relativeOrAbsolute)
    ? relativeOrAbsolute
    : path.join(vaultRoot, relativeOrAbsolute);
  return assertInsideRoot(candidate, vaultRoot, "vault");
}

export function resolveRuntimePath(relativeOrAbsolute = ""): string {
  const { runtimeRoot } = getYantraRoots();
  const candidate = path.isAbsolute(relativeOrAbsolute)
    ? relativeOrAbsolute
    : path.join(runtimeRoot, relativeOrAbsolute);
  return assertInsideRoot(candidate, runtimeRoot, "runtime");
}

export function toVaultRelative(absPath: string): string {
  const { vaultRoot } = getYantraRoots();
  const normalized = assertInsideRoot(absPath, vaultRoot, "vault");
  return path.relative(vaultRoot, normalized).split(path.sep).join("/");
}

export function toRuntimeRelative(absPath: string): string {
  const { runtimeRoot } = getYantraRoots();
  const normalized = assertInsideRoot(absPath, runtimeRoot, "runtime");
  return path.relative(runtimeRoot, normalized).split(path.sep).join("/");
}

export function isWithinRuntimeRoot(absPath: string): boolean {
  const { runtimeRoot } = getYantraRoots();
  const normalizedRoot = path.resolve(runtimeRoot);
  const normalizedPath = path.resolve(absPath);
  return (
    normalizedPath === normalizedRoot ||
    normalizedPath.startsWith(`${normalizedRoot}${path.sep}`)
  );
}
