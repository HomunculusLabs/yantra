import fs from "fs";
import path from "path";

export type YantraAppMode = "source" | "desktop";

export interface YantraAppPaths {
  mode: YantraAppMode;
  projectRoot: string;
  configRoot: string;
  rootsConfigPath: string;
  pluginsInstallDir: string;
  pluginsStatePath: string;
  migrationsDir: string;
  envFiles: string[];
}

let cachedPaths: YantraAppPaths | null = null;

function normalize(input: string): string {
  return path.resolve(input);
}

function parseEnvFileOverrides(raw: string | undefined, baseDir: string): string[] | null {
  if (!raw?.trim()) return null;
  return raw
    .split(path.delimiter)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => (path.isAbsolute(value) ? normalize(value) : normalize(path.join(baseDir, value))));
}

function inferMode(): YantraAppMode {
  return process.env.YANTRA_APP_MODE?.trim() === "desktop" ? "desktop" : "source";
}

export function clearYantraAppPathsCache(): void {
  cachedPaths = null;
}

export function getYantraAppPaths(): YantraAppPaths {
  if (cachedPaths) return cachedPaths;

  const mode = inferMode();
  const cwd = normalize(process.cwd());
  const projectRoot = normalize(
    process.env.YANTRA_PROJECT_ROOT?.trim() ||
      (mode === "desktop" ? process.resourcesPath || cwd : cwd)
  );
  const configRoot = normalize(
    process.env.YANTRA_APP_CONFIG_DIR?.trim() ||
      (mode === "desktop" ? path.join(projectRoot, ".config") : projectRoot)
  );

  const rootsConfigPath = normalize(
    process.env.YANTRA_ROOTS_CONFIG_PATH?.trim() ||
      path.join(configRoot, "yantra-roots.json")
  );
  const pluginsInstallDir = normalize(
    process.env.YANTRA_PLUGINS_INSTALL_DIR?.trim() || path.join(configRoot, "plugins")
  );
  const pluginsStatePath = normalize(
    process.env.YANTRA_PLUGINS_STATE_PATH?.trim() ||
      path.join(configRoot, "plugins-state.json")
  );
  const migrationsDir = normalize(
    process.env.YANTRA_MIGRATIONS_DIR?.trim() ||
      path.join(projectRoot, "server", "migrations")
  );

  const envFiles =
    parseEnvFileOverrides(process.env.YANTRA_ENV_FILE, configRoot) ||
    (mode === "desktop"
      ? [path.join(configRoot, ".env.local"), path.join(configRoot, ".env")]
      : [path.join(projectRoot, ".env.local"), path.join(projectRoot, ".env")]);

  cachedPaths = {
    mode,
    projectRoot,
    configRoot,
    rootsConfigPath,
    pluginsInstallDir,
    pluginsStatePath,
    migrationsDir,
    envFiles: envFiles.filter((filePath, index, array) => {
      return array.indexOf(filePath) === index;
    }),
  };

  return cachedPaths;
}

export function ensureConfigRootExists(): string {
  const { configRoot } = getYantraAppPaths();
  fs.mkdirSync(configRoot, { recursive: true });
  return configRoot;
}
