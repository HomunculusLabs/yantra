import fs from "fs";
import fsp from "fs/promises";
import path from "path";

export interface CabinetRoots {
  vaultRoot: string;
  runtimeRoot: string;
  runtimeAgentsRoot: string;
  runtimeJobsRoot: string;
  runtimeConfigRoot: string;
  runtimeDaemonRoot: string;
  databasePath: string;
}

export interface CabinetRootsConfigFile {
  vaultRoot?: string;
  runtimeRoot?: string;
}

let cachedRoots: CabinetRoots | null = null;

function normalizeRoot(input: string): string {
  return path.resolve(input);
}

function defaultVaultRoot(): string {
  return path.join(process.cwd(), "data");
}

function defaultRuntimeRoot(): string {
  return path.join(process.cwd(), "data");
}

export function getCabinetRootsConfigPath(): string {
  return path.join(process.cwd(), "cabinet-roots.json");
}

export function clearCabinetRootsCache(): void {
  cachedRoots = null;
}

export function readCabinetRootsConfig(): CabinetRootsConfigFile {
  try {
    const raw = fs.readFileSync(getCabinetRootsConfigPath(), "utf-8");
    const parsed = JSON.parse(raw) as CabinetRootsConfigFile;
    return {
      ...(parsed.vaultRoot?.trim() ? { vaultRoot: parsed.vaultRoot.trim() } : {}),
      ...(parsed.runtimeRoot?.trim() ? { runtimeRoot: parsed.runtimeRoot.trim() } : {}),
    };
  } catch {
    return {};
  }
}

export async function saveCabinetRootsConfig(
  config: CabinetRootsConfigFile
): Promise<CabinetRootsConfigFile> {
  const next: CabinetRootsConfigFile = {
    vaultRoot: normalizeRoot(config.vaultRoot?.trim() || defaultVaultRoot()),
    runtimeRoot: normalizeRoot(config.runtimeRoot?.trim() || defaultRuntimeRoot()),
  };

  await fsp.writeFile(
    getCabinetRootsConfigPath(),
    `${JSON.stringify(next, null, 2)}\n`,
    "utf-8"
  );
  return next;
}

export function getCabinetRoots(): CabinetRoots {
  if (cachedRoots) return cachedRoots;

  const config = readCabinetRootsConfig();
  const vaultRoot = normalizeRoot(
    process.env.CABINET_VAULT_ROOT?.trim() ||
      config.vaultRoot?.trim() ||
      defaultVaultRoot()
  );
  const runtimeRoot = normalizeRoot(
    process.env.CABINET_RUNTIME_ROOT?.trim() ||
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
    databasePath: path.join(runtimeRoot, ".cabinet.db"),
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
  const { vaultRoot } = getCabinetRoots();
  if (!fs.existsSync(vaultRoot)) {
    throw new Error(`Configured vault root does not exist: ${vaultRoot}`);
  }
  return vaultRoot;
}

export function ensureRuntimeRootExists(): string {
  const { runtimeRoot } = getCabinetRoots();
  fs.mkdirSync(runtimeRoot, { recursive: true });
  return runtimeRoot;
}

export function resolveVaultPath(relativeOrAbsolute = ""): string {
  const { vaultRoot } = getCabinetRoots();
  const candidate = path.isAbsolute(relativeOrAbsolute)
    ? relativeOrAbsolute
    : path.join(vaultRoot, relativeOrAbsolute);
  return assertInsideRoot(candidate, vaultRoot, "vault");
}

export function resolveRuntimePath(relativeOrAbsolute = ""): string {
  const { runtimeRoot } = getCabinetRoots();
  const candidate = path.isAbsolute(relativeOrAbsolute)
    ? relativeOrAbsolute
    : path.join(runtimeRoot, relativeOrAbsolute);
  return assertInsideRoot(candidate, runtimeRoot, "runtime");
}

export function toVaultRelative(absPath: string): string {
  const { vaultRoot } = getCabinetRoots();
  const normalized = assertInsideRoot(absPath, vaultRoot, "vault");
  return path.relative(vaultRoot, normalized).split(path.sep).join("/");
}

export function toRuntimeRelative(absPath: string): string {
  const { runtimeRoot } = getCabinetRoots();
  const normalized = assertInsideRoot(absPath, runtimeRoot, "runtime");
  return path.relative(runtimeRoot, normalized).split(path.sep).join("/");
}

export function isWithinRuntimeRoot(absPath: string): boolean {
  const { runtimeRoot } = getCabinetRoots();
  const normalizedRoot = path.resolve(runtimeRoot);
  const normalizedPath = path.resolve(absPath);
  return (
    normalizedPath === normalizedRoot ||
    normalizedPath.startsWith(`${normalizedRoot}${path.sep}`)
  );
}
