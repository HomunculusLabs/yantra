import path from "path";

export interface DesktopChildSpec {
  healthUrl: string;
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export interface DesktopRuntimeSpec {
  mode: "dev" | "packaged";
  appUrl: string;
  configRoot: string;
  defaultVaultRoot: string;
  defaultRuntimeRoot: string;
  seedDataDir?: string;
  envExamplePath?: string;
  web: DesktopChildSpec;
  daemon: DesktopChildSpec;
}

function localBin(projectRoot: string, name: string): string {
  const executable = process.platform === "win32" ? `${name}.cmd` : name;
  return path.join(projectRoot, "node_modules", ".bin", executable);
}

function sharedDesktopEnv(input: {
  projectRoot: string;
  configRoot: string;
  defaultVaultRoot: string;
  defaultRuntimeRoot: string;
  migrationsDir: string;
  nodeEnv: "development" | "production";
}): NodeJS.ProcessEnv {
  return {
    ...(process.env as Record<string, string>),
    PWD: input.projectRoot,
    INIT_CWD: input.projectRoot,
    npm_config_local_prefix: input.projectRoot,
    npm_package_json: path.join(input.projectRoot, "package.json"),
    NODE_ENV: input.nodeEnv,
    NEXT_TELEMETRY_DISABLED: "1",
    PORT: "3000",
    HOSTNAME: "127.0.0.1",
    YANTRA_APP_MODE: "desktop",
    YANTRA_PROJECT_ROOT: input.projectRoot,
    YANTRA_APP_CONFIG_DIR: input.configRoot,
    YANTRA_ROOTS_CONFIG_PATH: path.join(input.configRoot, "yantra-roots.json"),
    YANTRA_MIGRATIONS_DIR: input.migrationsDir,
    YANTRA_DEFAULT_VAULT_ROOT: input.defaultVaultRoot,
    YANTRA_DEFAULT_RUNTIME_ROOT: input.defaultRuntimeRoot,
    YANTRA_VAULT_ROOT: input.defaultVaultRoot,
    YANTRA_RUNTIME_ROOT: input.defaultRuntimeRoot,
    YANTRA_DAEMON_HOST: "127.0.0.1",
    YANTRA_DAEMON_URL: "http://127.0.0.1:3001",
    YANTRA_DAEMON_PUBLIC_ORIGIN: "http://127.0.0.1:3001",
  };
}

const moduleDir = __dirname;

function inferDevProjectRoot(): string {
  return path.resolve(moduleDir, "..");
}

export function getDesktopRuntimeSpec(input: {
  isPackaged: boolean;
  userDataPath: string;
}): DesktopRuntimeSpec {
  const appUrl = "http://127.0.0.1:3000";

  if (!input.isPackaged) {
    const projectRoot = path.resolve(
      process.env.YANTRA_PROJECT_ROOT || inferDevProjectRoot()
    );
    const configRoot = projectRoot;
    const defaultVaultRoot = path.join(projectRoot, "data");
    const defaultRuntimeRoot = path.join(projectRoot, "data");
    const sharedEnv = sharedDesktopEnv({
      projectRoot,
      configRoot,
      defaultVaultRoot,
      defaultRuntimeRoot,
      migrationsDir: path.join(projectRoot, "server", "migrations"),
      nodeEnv: "development",
    });

    return {
      mode: "dev",
      appUrl,
      configRoot,
      defaultVaultRoot,
      defaultRuntimeRoot,
      seedDataDir: path.join(projectRoot, "data"),
      envExamplePath: path.join(projectRoot, ".env.example"),
      web: {
        healthUrl: `${appUrl}/api/health`,
        command: process.env.YANTRA_NODE_BINARY || "node",
        args: [path.join(projectRoot, "scripts", "run-web-dev.mjs")],
        cwd: projectRoot,
        env: sharedEnv,
      },
      daemon: {
        healthUrl: "http://127.0.0.1:3001/health",
        command: process.env.YANTRA_NODE_BINARY || "node",
        args: [path.join(projectRoot, "scripts", "run-daemon-dev.mjs")],
        cwd: projectRoot,
        env: sharedEnv,
      },
    };
  }

  const runtimeRoot = path.join(process.resourcesPath, "app-runtime");
  const configRoot = input.userDataPath;
  const defaultVaultRoot = path.join(input.userDataPath, "vault");
  const defaultRuntimeRoot = path.join(input.userDataPath, "runtime");
  const sharedEnv = sharedDesktopEnv({
    projectRoot: runtimeRoot,
    configRoot,
    defaultVaultRoot,
    defaultRuntimeRoot,
    migrationsDir: path.join(runtimeRoot, "server", "migrations"),
    nodeEnv: "production",
  });
  const nodeEnv = {
    ...sharedEnv,
    ELECTRON_RUN_AS_NODE: "1",
  };

  return {
    mode: "packaged",
    appUrl,
    configRoot,
    defaultVaultRoot,
    defaultRuntimeRoot,
    seedDataDir: path.join(runtimeRoot, "seed-data"),
    envExamplePath: path.join(runtimeRoot, ".env.example"),
    web: {
      healthUrl: `${appUrl}/api/health`,
      command: process.execPath,
      args: [path.join(runtimeRoot, "web", "server.js")],
      cwd: path.join(runtimeRoot, "web"),
      env: nodeEnv,
    },
    daemon: {
      healthUrl: "http://127.0.0.1:3001/health",
      command: process.execPath,
      args: [path.join(runtimeRoot, "daemon", "yantra-daemon.js")],
      cwd: runtimeRoot,
      env: nodeEnv,
    },
  };
}
