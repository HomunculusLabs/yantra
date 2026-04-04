import { app, BrowserWindow, dialog, shell } from "electron";
import { spawn, type ChildProcess } from "child_process";
import { getDesktopRuntimeSpec, type DesktopRuntimeSpec, type DesktopChildSpec } from "./runtime";
import { seedDesktopState } from "./seed";

interface ManagedService {
  name: "web" | "daemon";
  healthUrl: string;
  owned: boolean;
  child?: ChildProcess;
  ready: boolean;
}

const managedServices: Record<"web" | "daemon", ManagedService> = {
  web: { name: "web", healthUrl: "", owned: false, ready: false },
  daemon: { name: "daemon", healthUrl: "", owned: false, ready: false },
};

let mainWindow: BrowserWindow | null = null;
let quitting = false;

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

async function ensureService(
  key: "web" | "daemon",
  spec: DesktopChildSpec,
  expectedService: string
): Promise<void> {
  managedServices[key].healthUrl = spec.healthUrl;

  if (await waitForHealth(spec.healthUrl, expectedService, 1000)) {
    managedServices[key].owned = false;
    managedServices[key].ready = true;
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

  child.once("exit", (code) => {
    managedServices[key].ready = false;
    if (!quitting) {
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

async function stopOwnedChildren(): Promise<void> {
  const owned = Object.values(managedServices).filter(
    (service) => service.owned && service.child
  );

  for (const service of owned) {
    service.child?.kill();
  }

  await Promise.all(
    owned.map(
      (service) =>
        new Promise<void>((resolve) => {
          if (!service.child) {
            resolve();
            return;
          }

          const timer = setTimeout(() => {
            service.child?.kill("SIGKILL");
            resolve();
          }, 5000);

          service.child.once("exit", () => {
            clearTimeout(timer);
            resolve();
          });
        })
    )
  );
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
  mainWindow.webContents.on(
    "render-process-gone",
    (_event, details) => {
      console.error(`[yantra:desktop] renderer crashed: ${details.reason}`);
      dialog.showErrorBox(
        "Yantra renderer crashed",
        `Reason: ${details.reason}`
      );
    }
  );
  mainWindow.webContents.on("console-message", (_event, level, message) => {
    console.log(`[yantra:renderer:${level}] ${message}`);
  });

  void mainWindow.loadURL(runtime.appUrl);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function boot(): Promise<void> {
  const runtime = getDesktopRuntimeSpec({
    isPackaged: app.isPackaged,
    userDataPath: app.getPath("userData"),
  });

  process.chdir(runtime.mode === "packaged" ? runtime.configRoot : runtime.web.cwd);
  console.log(`[yantra:desktop] mode=${runtime.mode}`);
  console.log(`[yantra:desktop] cwd=${process.cwd()}`);
  console.log(`[yantra:desktop] web cwd=${runtime.web.cwd}`);
  console.log(`[yantra:desktop] daemon cwd=${runtime.daemon.cwd}`);

  if (runtime.mode === "packaged") {
    seedDesktopState(runtime);
  }

  await Promise.all([
    ensureService("web", runtime.web, "yantra-web"),
    ensureService("daemon", runtime.daemon, "yantra-daemon"),
  ]);

  createWindow(runtime);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  void boot().catch((error) => {
    dialog.showErrorBox(
      "Yantra failed to launch",
      error instanceof Error ? error.message : String(error)
    );
    app.quit();
  });
});

app.on("window-all-closed", () => {
  app.quit();
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
