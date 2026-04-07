import type { InstalledPluginSummary } from "@/types/plugins";

export type PluginCatalogEntryKey = string;

export function getPluginCatalogEntryKey(
  plugin: Pick<InstalledPluginSummary, "manifest" | "source">
): PluginCatalogEntryKey {
  return [
    plugin.manifest?.id ?? "invalid-manifest",
    plugin.source.kind,
    plugin.source.rootPath,
    plugin.source.pluginPath,
  ].join("::");
}

function hashEntryKey(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function getPluginCatalogEntryToken(entryKey: PluginCatalogEntryKey): string {
  return `pek_${hashEntryKey(entryKey)}`;
}
