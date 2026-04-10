export {};

type DesktopDaemonRestartMode = "soft" | "force";

interface DesktopDaemonRestartPlan {
  activeSessionCount: number;
  directSessionCount: number;
  tmuxSessionCount: number;
  restoredTmuxSessionCount: number;
  preservableTmuxSessionCount: number;
  softSafe: boolean;
}

interface DesktopPluginInstallResult {
  pluginId: string;
  pluginName: string;
  sourcePath: string;
  installedPath: string;
}

interface DesktopPluginUninstallResult {
  pluginId: string | null;
  removedPath: string;
}

declare global {
  interface Window {
    yantraDesktop?: {
      restartDaemon: (
        mode: DesktopDaemonRestartMode
      ) => Promise<{
        mode: DesktopDaemonRestartMode;
        restartPlan?: DesktopDaemonRestartPlan;
      }>;
      getDaemonControlInfo: () => Promise<{
        available: boolean;
        healthUrl?: string;
        managed?: boolean;
        ready?: boolean;
        restarting?: boolean;
        restartingMode?: DesktopDaemonRestartMode | null;
      }>;
      selectDirectory: (options?: {
        title?: string;
        defaultPath?: string;
      }) => Promise<string | null>;
      openDataDirectory: () => Promise<{ ok: true }>;
      openRepositoryRoot: (input: {
        virtualPath: string;
      }) => Promise<{ ok: true; openedPath: string }>;
      installPluginFromDirectory: () => Promise<DesktopPluginInstallResult | null>;
      uninstallPlugin: (input: {
        pluginPath: string;
        pluginId?: string | null;
      }) => Promise<DesktopPluginUninstallResult>;
      reloadKeybindings: () => Promise<{ ok: true }>;
    };
  }
}
