import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
  type MenuItemConstructorOptions,
} from "electron";
import fs from "fs/promises";
import path from "path";
import { spawn, type ChildProcess } from "child_process";
import {
  getDesktopRuntimeSpec,
  type DesktopRuntimeSpec,
  type DesktopChildSpec,
} from "./runtime";
import { seedDesktopState } from "./seed";
import {
  YANTRA_APP_COMMAND_CHANNEL,
  type YantraAppCommand,
} from "../src/lib/desktop-commands";
import { loadKeybindingsConfigSync } from "../src/lib/agents/keybindings-manager";
import { getYantraAppPaths } from "../src/lib/config/app-paths";
import { listInstalledPlugins } from "../src/lib/plugins/plugin-manager";
import { readValidatedPluginDirectory } from "../src/lib/plugins/plugin-manifest";
import type { YantraKeybindingAction } from "../src/lib/keybindings";

type DesktopDaemonRestartMode = "soft" | "force";

interface ManagedService {
  name: "web" | "daemon";
  healthUrl: string;
  owned: boolean;
  child?: ChildProcess;
  ready: boolean;
  stopping?: boolean;
  restartingMode?: DesktopDaemonRestartMode | null;
}

const managedServices: Record<"web" | "daemon", ManagedService> = {
  web: { name: "web", healthUrl: "", owned: false, ready: false, restartingMode: null },
  daemon: { name: "daemon", healthUrl: "", owned: false, ready: false, restartingMode: null },
};

let mainWindow: BrowserWindow | null = null;
let currentRuntime: DesktopRuntimeSpec | null = null;
let quitting = false;

function initializeRuntime(): DesktopRuntimeSpec {
  if (currentRuntime) {
    return currentRuntime;
  }

  const runtime = getDesktopRuntimeSpec({
    isPackaged: app.isPackaged,
    userDataPath: app.getPath("userData"),
  });
  currentRuntime = runtime;

  process.chdir(runtime.mode === "packaged" ? runtime.configRoot : runtime.web.cwd);
  console.log(`[yantra:desktop] mode=${runtime.mode}`);
  console.log(`[yantra:desktop] cwd=${process.cwd()}`);
  console.log(`[yantra:desktop] web cwd=${runtime.web.cwd}`);
  console.log(`[yantra:desktop] daemon cwd=${runtime.daemon.cwd}`);

  return runtime;
}

async function waitForHealth(
  url: string,
  expectedService: string,
  timeoutMs = 30000
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const data = (await response.json()) as {
          service?: string;
          status?: string;
        };
        if (data.status === "ok" && data.service === expectedService) {
          return true;
        }
      }
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function attachChildLogging(name: string, child: ChildProcess): void {
  child.stdout?.on("data", (chunk) => {
    process.stdout.write(`[yantra:${name}] ${chunk}`);
  });
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(`[yantra:${name}] ${chunk}`);
  });
}

function getExpectedServiceName(key: "web" | "daemon"): string {
  return key === "web" ? "yantra-web" : "yantra-daemon";
}

async function stopManagedService(key: "web" | "daemon"): Promise<void> {
  const service = managedServices[key];
  const child = service.child;
  if (!service.owned || !child) {
    throw new Error(`${key} is not managed by this app session.`);
  }

  service.stopping = true;
  service.ready = false;

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5000);

    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });

    child.kill();
  });
}

async function waitForManagedServiceExit(
  key: "web" | "daemon",
  timeoutMs: number
): Promise<boolean> {
  const child = managedServices[key].child;
  if (!child || child.exitCode !== null) {
    return true;
  }

  return await new Promise<boolean>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(false);
    }, timeoutMs);

    child.once("exit", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function requestDaemonShutdown(
  mode: DesktopDaemonRestartMode
): Promise<{ mode: DesktopDaemonRestartMode; restartPlan?: unknown }> {
  if (!currentRuntime) {
    throw new Error("Desktop runtime is not initialized yet.");
  }

  const authResponse = await fetch(`${currentRuntime.appUrl}/api/daemon/auth`);
  const authData = (await authResponse.json().catch(() => null)) as { token?: string } | null;
  if (!authResponse.ok || !authData?.token) {
    throw new Error("Failed to acquire daemon admin token.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  const daemonBaseUrl = new URL(managedServices.daemon.healthUrl).origin;
  const response = await fetch(`${daemonBaseUrl}/shutdown`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authData.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ mode }),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));
  const data = (await response.json().catch(() => null)) as {
    error?: string;
    restartPlan?: unknown;
  } | null;

  if (!response.ok) {
    throw new Error(data?.error || `Failed to request daemon ${mode} restart.`);
  }

  return { mode, restartPlan: data?.restartPlan };
}

async function ensureService(
  key: "web" | "daemon",
  spec: DesktopChildSpec,
  expectedService: string,
  options?: { fatalOnFailure?: boolean }
): Promise<void> {
  const fatalOnFailure = options?.fatalOnFailure !== false;
  managedServices[key].healthUrl = spec.healthUrl;

  if (await waitForHealth(spec.healthUrl, expectedService, 1000)) {
    managedServices[key].owned = false;
    managedServices[key].ready = true;
    managedServices[key].stopping = false;
    managedServices[key].restartingMode = null;
    return;
  }

  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    stdio: "pipe",
  });
  attachChildLogging(key, child);

  managedServices[key].child = child;
  managedServices[key].owned = true;
  managedServices[key].stopping = false;
  managedServices[key].restartingMode = null;

  child.once("exit", (code) => {
    const intentionalStop = quitting || managedServices[key].stopping;
    managedServices[key].ready = false;
    managedServices[key].owned = false;
    managedServices[key].child = undefined;
    managedServices[key].stopping = false;
    managedServices[key].restartingMode = null;

    if (!intentionalStop && fatalOnFailure) {
      dialog.showErrorBox(
        "Yantra failed to start",
        `${key} service exited before startup completed (code ${code ?? "unknown"}).`
      );
      app.quit();
    }
  });

  const healthy = await waitForHealth(spec.healthUrl, expectedService, 45000);
  if (!healthy) {
    child.kill();
    throw new Error(`Timed out waiting for ${key} service at ${spec.healthUrl}`);
  }

  managedServices[key].ready = true;
}

async function restartManagedService(
  key: "web" | "daemon",
  mode: DesktopDaemonRestartMode = "force"
): Promise<{ mode: DesktopDaemonRestartMode; restartPlan?: unknown }> {
  if (!currentRuntime) {
    throw new Error("Desktop runtime is not initialized yet.");
  }

  const service = managedServices[key];
  if (!service.owned || !service.child) {
    throw new Error(
      `${key} is not currently owned by this app, so it cannot be restarted from within Yantra.`
    );
  }

  service.stopping = true;
  service.ready = false;
  service.restartingMode = mode;

  let result: { mode: DesktopDaemonRestartMode; restartPlan?: unknown } = { mode };

  try {
    if (key === "daemon") {
      try {
        result = await requestDaemonShutdown(mode);
      } catch (error) {
        if (mode === "soft") {
          throw error;
        }
        await stopManagedService(key);
      }

      const exited = await waitForManagedServiceExit(key, 15000);
      if (!exited) {
        if (mode === "soft") {
          throw new Error("Timed out waiting for daemon soft restart.");
        }
        await stopManagedService(key);
      }
    } else {
      await stopManagedService(key);
    }

    await ensureService(key, currentRuntime[key], getExpectedServiceName(key), {
      fatalOnFailure: false,
    });
    service.stopping = false;
    service.restartingMode = null;
    return result;
  } catch (error) {
    if (!service.child || service.child.exitCode !== null) {
      service.stopping = false;
      service.restartingMode = null;
    }
    throw error;
  }
}

async function stopOwnedChildren(): Promise<void> {
  const owned = Object.entries(managedServices).filter(
    ([, service]) => service.owned && service.child
  ) as Array<["web" | "daemon", ManagedService]>;

  for (const [key] of owned) {
    await stopManagedService(key).catch(() => {});
  }
}

function resolvePreloadPath(runtime: DesktopRuntimeSpec): string {
  return runtime.mode === "dev"
    ? path.join(process.cwd(), "dist", "electron", "preload.js")
    : path.join(__dirname, "preload.js");
}

function createWindow(runtime: DesktopRuntimeSpec): void {
  const isDev = runtime.mode === "dev";

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    title: "Yantra",
    backgroundColor: "#231c16",
    show: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      preload: resolvePreloadPath(runtime),
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(runtime.appUrl)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
  mainWindow.webContents.on("did-finish-load", () => {
    console.log(`[yantra:desktop] renderer loaded ${runtime.appUrl}`);
    if (isDev) {
      mainWindow?.webContents.openDevTools({ mode: "detach" });
    }
  });
  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL) => {
      console.error(
        `[yantra:desktop] failed to load ${validatedURL}: ${errorCode} ${errorDescription}`
      );
      dialog.showErrorBox(
        "Yantra renderer failed to load",
        `${validatedURL}\n${errorCode} ${errorDescription}`
      );
    }
  );
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error(`[yantra:desktop] renderer crashed: ${details.reason}`);
    dialog.showErrorBox(
      "Yantra renderer crashed",
      `Reason: ${details.reason}`
    );
  });
  mainWindow.webContents.on("console-message", (_event, level, message) => {
    console.log(`[yantra:renderer:${level}] ${message}`);
  });

  void mainWindow.loadURL(runtime.appUrl);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function restoreOrCreateWindow(): void {
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  if (currentRuntime) {
    createWindow(currentRuntime);
  }
}

type DesktopPluginInstallResult = {
  pluginId: string;
  pluginName: string;
  sourcePath: string;
  installedPath: string;
};

type DesktopPluginUninstallInput = {
  pluginPath: string;
  pluginId?: string | null;
};

type DesktopPluginUninstallResult = {
  pluginId: string | null;
  removedPath: string;
};

function isWithinDirectory(rootPath: string, targetPath: string): boolean {
  const normalizedRoot = path.resolve(rootPath);
  const normalizedTarget = path.resolve(targetPath);
  return (
    normalizedTarget === normalizedRoot ||
    normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`)
  );
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function assertNoSymlinks(rootPath: string): Promise<void> {
  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Plugin install source cannot contain symlinks: ${entry.name}`);
    }
    if (entry.isDirectory()) {
      await assertNoSymlinks(entryPath);
    }
  }
}

async function pickPluginDirectory(): Promise<string | null> {
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, {
        title: "Install plugin from folder",
        properties: ["openDirectory"],
      })
    : await dialog.showOpenDialog({
        title: "Install plugin from folder",
        properties: ["openDirectory"],
      });

  if (result.canceled) {
    return null;
  }

  return result.filePaths[0] ? path.resolve(result.filePaths[0]) : null;
}

async function installPluginFromDirectory(): Promise<DesktopPluginInstallResult | null> {
  const sourcePath = await pickPluginDirectory();
  if (!sourcePath) {
    return null;
  }

  const { pluginsInstallDir } = getYantraAppPaths();
  const installRoot = path.resolve(pluginsInstallDir);
  await fs.mkdir(installRoot, { recursive: true });

  const sourceLinkStats = await fs.lstat(sourcePath).catch(() => null);
  if (sourceLinkStats?.isSymbolicLink()) {
    throw new Error("Plugin install source cannot be a symlink.");
  }
  const sourceStats = await fs.stat(sourcePath).catch(() => null);
  if (!sourceStats?.isDirectory()) {
    throw new Error("Selected plugin source must be a directory.");
  }
  if (isWithinDirectory(installRoot, sourcePath)) {
    throw new Error("Cannot install a plugin from inside the local install directory.");
  }

  await assertNoSymlinks(sourcePath);

  const validated = await readValidatedPluginDirectory(sourcePath);
  const blockingIssues = validated.issues.filter((issue) => issue.severity === "error");
  if (!validated.manifest || blockingIssues.length > 0) {
    const message =
      blockingIssues[0]?.message ||
      "Selected directory does not contain a valid installable plugin.";
    throw new Error(message);
  }

  const existingPlugins = await listInstalledPlugins();
  if (existingPlugins.some((plugin) => plugin.manifest?.id === validated.manifest?.id)) {
    throw new Error(
      `A plugin with id '${validated.manifest.id}' is already installed or discovered.`
    );
  }

  const destinationPath = path.join(installRoot, path.basename(sourcePath));
  if (await pathExists(destinationPath)) {
    throw new Error(
      `A plugin folder named '${path.basename(destinationPath)}' already exists in the local install directory.`
    );
  }

  const stagingPath = path.join(
    installRoot,
    `.installing-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  );

  try {
    await fs.cp(sourcePath, stagingPath, {
      recursive: true,
      force: false,
      errorOnExist: true,
      dereference: false,
    });

    const stagedValidation = await readValidatedPluginDirectory(stagingPath);
    if (
      !stagedValidation.manifest ||
      stagedValidation.manifest.id !== validated.manifest.id ||
      stagedValidation.issues.some((issue) => issue.severity === "error")
    ) {
      throw new Error("Copied plugin failed validation before install could complete.");
    }

    await fs.rename(stagingPath, destinationPath);

    return {
      pluginId: validated.manifest.id,
      pluginName: validated.manifest.name,
      sourcePath,
      installedPath: destinationPath,
    };
  } catch (error) {
    await fs.rm(stagingPath, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function uninstallLocalPlugin(
  input: DesktopPluginUninstallInput
): Promise<DesktopPluginUninstallResult> {
  if (!input?.pluginPath || typeof input.pluginPath !== "string") {
    throw new Error("Plugin uninstall requires a pluginPath.");
  }

  const { pluginsInstallDir } = getYantraAppPaths();
  const installRoot = path.resolve(pluginsInstallDir);
  const targetPath = path.resolve(input.pluginPath);

  if (!isWithinDirectory(installRoot, targetPath) || targetPath === installRoot) {
    throw new Error("Only local-install plugins can be removed from the desktop app.");
  }

  const localInstallRoots = new Set(
    (await listInstalledPlugins())
      .filter((plugin) => plugin.source.kind === "local-install")
      .map((plugin) => path.resolve(plugin.source.pluginPath))
  );
  if (!localInstallRoots.has(targetPath)) {
    throw new Error("Only discovered local-install plugin roots can be removed.");
  }

  if (!(await pathExists(targetPath))) {
    return {
      pluginId: input.pluginId ?? null,
      removedPath: targetPath,
    };
  }

  let resolvedPluginId: string | null = input.pluginId ?? null;
  const validated = await readValidatedPluginDirectory(targetPath);
  if (validated.manifest?.id) {
    resolvedPluginId = validated.manifest.id;
    if (input.pluginId && input.pluginId !== validated.manifest.id) {
      throw new Error("Plugin uninstall target did not match the expected plugin id.");
    }
  }

  await fs.rm(targetPath, { recursive: true, force: true });
  return {
    pluginId: resolvedPluginId,
    removedPath: targetPath,
  };
}

function sendAppCommand(command: YantraAppCommand): void {
  restoreOrCreateWindow();

  if (!mainWindow) {
    return;
  }

  const targetWindow = mainWindow;
  const dispatch = () => {
    if (!targetWindow.isDestroyed()) {
      targetWindow.webContents.send(YANTRA_APP_COMMAND_CHANNEL, command);
    }
  };

  if (targetWindow.webContents.isLoadingMainFrame()) {
    targetWindow.webContents.once("did-finish-load", dispatch);
    return;
  }

  dispatch();
}

function getConfiguredAccelerator(
  bindings: ReturnType<typeof loadKeybindingsConfigSync>["bindings"],
  action: YantraKeybindingAction,
  slot = 0
): string | undefined {
  return bindings[action]?.accelerators[slot];
}

function createCommandMenuItem(
  label: string,
  command: YantraAppCommand,
  accelerator?: string
): MenuItemConstructorOptions {
  return {
    label,
    accelerator,
    click: () => sendAppCommand(command),
  };
}

function createOpenYantraMenuItem(accelerator?: string): MenuItemConstructorOptions {
  return {
    label: "Open Yantra",
    accelerator,
    click: () => restoreOrCreateWindow(),
  };
}

function createCloseWindowMenuItem(accelerator?: string): MenuItemConstructorOptions {
  return {
    label: "Close Window",
    accelerator,
    click: () => {
      mainWindow?.close();
    },
  };
}

function installMenus(): void {
  const keybindings = loadKeybindingsConfigSync().bindings;
  const openYantraAccelerator = getConfiguredAccelerator(keybindings, "open-yantra-window");
  const closeWindowAccelerator = getConfiguredAccelerator(keybindings, "close-window");

  const fileMenu: MenuItemConstructorOptions = {
    label: "File",
    submenu: [
      ...(process.platform === "darwin"
        ? []
        : ([createOpenYantraMenuItem(openYantraAccelerator), { type: "separator" }] as MenuItemConstructorOptions[])),
      createCommandMenuItem("New File…", "new-page", getConfiguredAccelerator(keybindings, "new-page")),
      createCommandMenuItem("Quick Open…", "quick-search", getConfiguredAccelerator(keybindings, "quick-search", 0)),
      createCommandMenuItem("Search…", "quick-search", getConfiguredAccelerator(keybindings, "quick-search", 1)),
      { type: "separator" },
      createCommandMenuItem("Save", "save", getConfiguredAccelerator(keybindings, "save")),
      createCommandMenuItem("Close Note", "close-note", getConfiguredAccelerator(keybindings, "close-note")),
      { type: "separator" },
      createCommandMenuItem("Settings…", "open-settings", getConfiguredAccelerator(keybindings, "open-settings")),
      { type: "separator" },
      createCloseWindowMenuItem(closeWindowAccelerator),
      ...(process.platform === "darwin"
        ? []
        : ([
            { type: "separator" },
            {
              label: "Quit Yantra",
              accelerator: "CmdOrCtrl+Q",
              click: () => app.quit(),
            },
          ] as MenuItemConstructorOptions[])),
    ],
  };

  const editMenu: MenuItemConstructorOptions = {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    ],
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: "View",
    submenu: [
      createCommandMenuItem("Focus Sidebar", "focus-sidebar", getConfiguredAccelerator(keybindings, "focus-sidebar")),
      createCommandMenuItem("Toggle Sidebar", "toggle-sidebar", getConfiguredAccelerator(keybindings, "toggle-sidebar")),
      { type: "separator" },
      createCommandMenuItem(
        "Toggle Split View",
        "toggle-split-pane",
        getConfiguredAccelerator(keybindings, "toggle-split-pane")
      ),
      createCommandMenuItem("Toggle Terminal", "toggle-terminal", getConfiguredAccelerator(keybindings, "toggle-terminal")),
      { type: "separator" },
      createCommandMenuItem(
        "Toggle AI Editor",
        "toggle-editor-ai",
        getConfiguredAccelerator(keybindings, "toggle-editor-ai")
      ),
      createCommandMenuItem(
        "Toggle Agents Panel",
        "toggle-agent-sidebar",
        getConfiguredAccelerator(keybindings, "toggle-agent-sidebar")
      ),
      createCommandMenuItem(
        "Toggle Tasks Panel",
        "toggle-tasks-panel",
        getConfiguredAccelerator(keybindings, "toggle-tasks-panel")
      ),
      { type: "separator" },
      { role: "reload" },
      { role: "forceReload" },
      { role: "togglefullscreen" },
      ...(!app.isPackaged ? ([{ role: "toggleDevTools" }] as MenuItemConstructorOptions[]) : []),
    ],
  };

  const windowMenu: MenuItemConstructorOptions = {
    label: "Window",
    submenu: [
      createOpenYantraMenuItem(),
      createCloseWindowMenuItem(),
      { role: "minimize" },
      { role: "zoom" },
      ...(process.platform === "darwin"
        ? ([{ type: "separator" }, { role: "front" }] as MenuItemConstructorOptions[])
        : []),
    ],
  };

  const template: MenuItemConstructorOptions[] =
    process.platform === "darwin"
      ? [
          {
            label: "Yantra",
            submenu: [
              createOpenYantraMenuItem(openYantraAccelerator),
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              {
                label: "Quit Yantra",
                accelerator: "CmdOrCtrl+Q",
                click: () => app.quit(),
              },
            ],
          },
          fileMenu,
          editMenu,
          viewMenu,
          windowMenu,
        ]
      : [fileMenu, editMenu, viewMenu, windowMenu];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  if (process.platform === "darwin" && app.dock) {
    app.dock.setMenu(
      Menu.buildFromTemplate([
        createOpenYantraMenuItem(),
        {
          label: "Quit Yantra",
          click: () => app.quit(),
        },
      ])
    );
  }
}

async function boot(): Promise<void> {
  const runtime = initializeRuntime();

  if (runtime.mode === "packaged") {
    seedDesktopState(runtime);
  }

  await Promise.all([
    ensureService("web", runtime.web, "yantra-web"),
    ensureService("daemon", runtime.daemon, "yantra-daemon"),
  ]);

  createWindow(runtime);
}

ipcMain.handle("yantra:daemon:info", async () => {
  return {
    available: Boolean(currentRuntime),
    healthUrl: managedServices.daemon.healthUrl || currentRuntime?.daemon.healthUrl,
    managed: managedServices.daemon.owned,
    ready: managedServices.daemon.ready,
    restarting: Boolean(managedServices.daemon.stopping),
    restartingMode: managedServices.daemon.restartingMode || null,
  };
});

ipcMain.handle(
  "yantra:daemon:restart",
  async (_event, mode: DesktopDaemonRestartMode = "force") => {
    return restartManagedService("daemon", mode);
  }
);

ipcMain.handle("yantra:keybindings:reload", async () => {
  installMenus();
  return { ok: true } as const;
});

ipcMain.handle(
  "yantra:select-directory",
  async (
    _event,
    options?: {
      title?: string;
      defaultPath?: string;
    }
  ) => {
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, {
          title: options?.title,
          defaultPath: options?.defaultPath,
          properties: ["openDirectory", "createDirectory"],
        })
      : await dialog.showOpenDialog({
          title: options?.title,
          defaultPath: options?.defaultPath,
          properties: ["openDirectory", "createDirectory"],
        });

    if (result.canceled) {
      return null;
    }

    return result.filePaths[0] ?? null;
  }
);

ipcMain.handle("yantra:plugins:install-from-directory", async () => {
  return installPluginFromDirectory();
});

ipcMain.handle(
  "yantra:plugins:uninstall-local",
  async (_event, input: DesktopPluginUninstallInput) => {
    return uninstallLocalPlugin(input);
  }
);

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on("second-instance", () => {
  restoreOrCreateWindow();
});

app.whenReady().then(() => {
  initializeRuntime();
  installMenus();
  void boot().catch((error) => {
    dialog.showErrorBox(
      "Yantra failed to launch",
      error instanceof Error ? error.message : String(error)
    );
    app.quit();
  });
});

app.on("activate", () => {
  restoreOrCreateWindow();
});

app.on("window-all-closed", () => {
  // Keep the Electron process alive so the daemon continues running.
  // Users can reopen the UI from the dock; explicit app quit still stops children.
});

app.on("before-quit", () => {
  quitting = true;
});

app.on("will-quit", (event) => {
  event.preventDefault();
  void stopOwnedChildren().finally(() => {
    app.exit(0);
  });
});
