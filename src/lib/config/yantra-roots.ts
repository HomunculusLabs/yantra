import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { getYantraAppPaths } from "@/lib/config/app-paths";

export type StorageRouteKey =
  | "agents"
  | "skills"
  | "extensions"
  | "plugins"
  | "mcp"
  | "todo"
  | "tasks";

export interface YantraStorageRouteConfig {
  path: string;
  recursive: boolean;
}

export interface YantraStorageRoutes {
  agents: YantraStorageRouteConfig;
  skills: YantraStorageRouteConfig;
  extensions: YantraStorageRouteConfig;
  plugins: YantraStorageRouteConfig;
  mcp: YantraStorageRouteConfig;
  todo: YantraStorageRouteConfig;
  tasks: YantraStorageRouteConfig;
}

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
  storageRoutes?: Partial<Record<StorageRouteKey, Partial<YantraStorageRouteConfig>>>;
}

let cachedRoots: YantraRoots | null = null;

const DEFAULT_STORAGE_ROUTES: YantraStorageRoutes = {
  agents: { path: ".agents", recursive: true },
  skills: { path: ".agents/skills", recursive: true },
  extensions: { path: ".agents/extensions", recursive: true },
  plugins: { path: ".plugins", recursive: false },
  mcp: { path: ".agents/mcp", recursive: true },
  todo: { path: "TODO", recursive: true },
  tasks: { path: "tasks", recursive: true },
};

function toPosix(input: string): string {
  return input.split(path.sep).join("/");
}

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
    const nextStorageRoutes: Partial<
      Record<StorageRouteKey, Partial<YantraStorageRouteConfig>>
    > = {};

    for (const key of Object.keys(DEFAULT_STORAGE_ROUTES) as StorageRouteKey[]) {
      const candidate = parsed.storageRoutes?.[key];
      if (!candidate || typeof candidate !== "object") continue;

      const normalized: Partial<YantraStorageRouteConfig> = {};
      if (typeof candidate.path === "string" && candidate.path.trim()) {
        normalized.path = candidate.path.trim();
      }
      if (typeof candidate.recursive === "boolean") {
        normalized.recursive = candidate.recursive;
      }
      if (Object.keys(normalized).length > 0) {
        nextStorageRoutes[key] = normalized;
      }
    }

    return {
      ...(parsed.vaultRoot?.trim() ? { vaultRoot: parsed.vaultRoot.trim() } : {}),
      ...(parsed.runtimeRoot?.trim() ? { runtimeRoot: parsed.runtimeRoot.trim() } : {}),
      ...(Object.keys(nextStorageRoutes).length > 0
        ? { storageRoutes: nextStorageRoutes }
        : {}),
    };
  } catch {
    return {};
  }
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

function normalizeVaultScopedPath(
  input: string | undefined,
  vaultRoot: string,
  fallback: string
): string {
  const value = input?.trim() || fallback;
  if (path.isAbsolute(value)) {
    const resolved = assertInsideRoot(value, vaultRoot, "vault");
    return toPosix(path.relative(path.resolve(vaultRoot), resolved) || ".");
  }

  const cleaned = value.replace(/^\.\/+/, "") || ".";
  const resolved = assertInsideRoot(path.join(vaultRoot, cleaned), vaultRoot, "vault");
  return toPosix(path.relative(path.resolve(vaultRoot), resolved) || ".");
}

export function resolveConfiguredVaultPath(
  relativeOrAbsolute: string,
  vaultRoot = getYantraRoots().vaultRoot
): string {
  const cleaned = relativeOrAbsolute.trim();
  const candidate = path.isAbsolute(cleaned)
    ? cleaned
    : path.join(vaultRoot, cleaned.replace(/^\.\/+/, ""));
  return assertInsideRoot(candidate, vaultRoot, "vault");
}

export function getYantraStorageRoutes(
  config: YantraRootsConfigFile = readYantraRootsConfig(),
  vaultRoot = getYantraRoots().vaultRoot
): YantraStorageRoutes {
  return {
    agents: {
      path: normalizeVaultScopedPath(
        config.storageRoutes?.agents?.path,
        vaultRoot,
        DEFAULT_STORAGE_ROUTES.agents.path
      ),
      recursive:
        config.storageRoutes?.agents?.recursive ?? DEFAULT_STORAGE_ROUTES.agents.recursive,
    },
    skills: {
      path: normalizeVaultScopedPath(
        config.storageRoutes?.skills?.path,
        vaultRoot,
        DEFAULT_STORAGE_ROUTES.skills.path
      ),
      recursive:
        config.storageRoutes?.skills?.recursive ?? DEFAULT_STORAGE_ROUTES.skills.recursive,
    },
    extensions: {
      path: normalizeVaultScopedPath(
        config.storageRoutes?.extensions?.path,
        vaultRoot,
        DEFAULT_STORAGE_ROUTES.extensions.path
      ),
      recursive:
        config.storageRoutes?.extensions?.recursive ??
        DEFAULT_STORAGE_ROUTES.extensions.recursive,
    },
    plugins: {
      path: normalizeVaultScopedPath(
        config.storageRoutes?.plugins?.path,
        vaultRoot,
        DEFAULT_STORAGE_ROUTES.plugins.path
      ),
      recursive:
        config.storageRoutes?.plugins?.recursive ?? DEFAULT_STORAGE_ROUTES.plugins.recursive,
    },
    mcp: {
      path: normalizeVaultScopedPath(
        config.storageRoutes?.mcp?.path,
        vaultRoot,
        DEFAULT_STORAGE_ROUTES.mcp.path
      ),
      recursive: config.storageRoutes?.mcp?.recursive ?? DEFAULT_STORAGE_ROUTES.mcp.recursive,
    },
    todo: {
      path: normalizeVaultScopedPath(
        config.storageRoutes?.todo?.path,
        vaultRoot,
        DEFAULT_STORAGE_ROUTES.todo.path
      ),
      recursive: config.storageRoutes?.todo?.recursive ?? DEFAULT_STORAGE_ROUTES.todo.recursive,
    },
    tasks: {
      path: normalizeVaultScopedPath(
        config.storageRoutes?.tasks?.path,
        vaultRoot,
        DEFAULT_STORAGE_ROUTES.tasks.path
      ),
      recursive:
        config.storageRoutes?.tasks?.recursive ?? DEFAULT_STORAGE_ROUTES.tasks.recursive,
    },
  };
}

export async function saveYantraRootsConfig(
  config: YantraRootsConfigFile
): Promise<YantraRootsConfigFile> {
  const configPath = getYantraRootsConfigPath();
  const vaultRoot = normalizeRoot(config.vaultRoot?.trim() || defaultVaultRoot());
  const runtimeRoot = normalizeRoot(config.runtimeRoot?.trim() || defaultRuntimeRoot());
  const next: YantraRootsConfigFile = {
    vaultRoot,
    runtimeRoot,
    storageRoutes: getYantraStorageRoutes(config, vaultRoot),
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
