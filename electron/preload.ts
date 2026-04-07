import { contextBridge, ipcRenderer } from "electron";
import {
  YANTRA_APP_COMMAND_CHANNEL,
  YANTRA_APP_COMMAND_EVENT,
  type YantraAppCommand,
} from "../src/lib/desktop-commands";

ipcRenderer.on(
  YANTRA_APP_COMMAND_CHANNEL,
  (_event, command: YantraAppCommand) => {
    window.dispatchEvent(
      new CustomEvent<YantraAppCommand>(YANTRA_APP_COMMAND_EVENT, {
        detail: command,
      })
    );
  }
);

contextBridge.exposeInMainWorld("yantraDesktop", {
  restartDaemon: (mode: "soft" | "force") => ipcRenderer.invoke("yantra:daemon:restart", mode),
  getDaemonControlInfo: () => ipcRenderer.invoke("yantra:daemon:info"),
  selectDirectory: (options: { title?: string; defaultPath?: string } | undefined) =>
    ipcRenderer.invoke("yantra:select-directory", options),
  installPluginFromDirectory: () =>
    ipcRenderer.invoke("yantra:plugins:install-from-directory"),
  uninstallPlugin: (input: { pluginPath: string; pluginId?: string | null }) =>
    ipcRenderer.invoke("yantra:plugins:uninstall-local", input),
  reloadKeybindings: () => ipcRenderer.invoke("yantra:keybindings:reload"),
});
