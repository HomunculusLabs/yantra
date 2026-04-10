export const YANTRA_APP_COMMANDS = [
  "new-page",
  "quick-search",
  "save",
  "close-note",
  "toggle-terminal",
  "toggle-editor-ai",
  "toggle-agent-sidebar",
  "toggle-tasks-panel",
  "focus-sidebar",
  "toggle-sidebar",
  "toggle-split-pane",
  "open-settings",
] as const;

export type YantraAppCommand = (typeof YANTRA_APP_COMMANDS)[number];

export const YANTRA_APP_COMMAND_CHANNEL = "yantra:command";
export const YANTRA_APP_COMMAND_EVENT = "yantra:app-command";

export function isDesktopBridgeAvailable(): boolean {
  return typeof window !== "undefined" && Boolean(window.yantraDesktop);
}
