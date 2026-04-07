import type { SelectedSection } from "@/stores/app-store";

export function shouldRememberPreviousSection(
  section: SelectedSection,
  pluginReturnSection: SelectedSection | null
): boolean {
  const openedPluginFromSettings =
    section.type === "plugin" && pluginReturnSection?.type === "settings";

  return section.type !== "settings" && !openedPluginFromSettings;
}
