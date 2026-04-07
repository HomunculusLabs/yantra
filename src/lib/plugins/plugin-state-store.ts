import path from "path";
import { getYantraAppPaths } from "@/lib/config/app-paths";
import {
  ensureDirectory,
  fileExists,
  readFileContent,
  writeFileContent,
} from "@/lib/storage/fs-operations";
import { isPluginCapability } from "@/lib/plugins/plugin-capabilities";
import type {
  PluginStateFile,
  PluginStateRecord,
  PluginTrust,
} from "@/types/plugins";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeTrust(value: unknown): PluginTrust {
  return value === "trusted-local" ? "trusted-local" : "sandboxed";
}

function normalizeGrantedCapabilities(value: unknown): PluginStateRecord["grantedCapabilities"] {
  if (!Array.isArray(value)) return [];
  const capabilities = value.filter(
    (item): item is PluginStateRecord["grantedCapabilities"][number] =>
      typeof item === "string" && isPluginCapability(item)
  );
  return [...new Set(capabilities)];
}

export function createDefaultPluginStateRecord(): PluginStateRecord {
  return {
    enabled: false,
    trust: "sandboxed",
    grantedCapabilities: [],
    settings: {},
    approvedManifestHash: undefined,
    lastError: null,
    lastEnabledAt: null,
  };
}

export function normalizePluginStateRecord(value: unknown): PluginStateRecord {
  const defaults = createDefaultPluginStateRecord();
  if (!isRecord(value)) return defaults;

  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : defaults.enabled,
    trust: normalizeTrust(value.trust),
    grantedCapabilities: normalizeGrantedCapabilities(value.grantedCapabilities),
    settings: isRecord(value.settings) ? value.settings : defaults.settings,
    approvedManifestHash:
      typeof value.approvedManifestHash === "string" && value.approvedManifestHash.trim()
        ? value.approvedManifestHash.trim()
        : undefined,
    lastError:
      typeof value.lastError === "string"
        ? value.lastError
        : value.lastError === null
          ? null
          : defaults.lastError,
    lastEnabledAt:
      typeof value.lastEnabledAt === "string"
        ? value.lastEnabledAt
        : value.lastEnabledAt === null
          ? null
          : defaults.lastEnabledAt,
  };
}

export function createDefaultPluginStateFile(): PluginStateFile {
  return {
    version: 1,
    plugins: {},
  };
}

export function normalizePluginStateFile(value: unknown): PluginStateFile {
  const defaults = createDefaultPluginStateFile();
  if (!isRecord(value)) return defaults;

  const pluginsInput = isRecord(value.plugins) ? value.plugins : {};
  const plugins = Object.fromEntries(
    Object.entries(pluginsInput).map(([pluginId, record]) => [
      pluginId,
      normalizePluginStateRecord(record),
    ])
  );

  return {
    version: 1,
    plugins,
  };
}

export function getPluginStateFilePath(): string {
  return getYantraAppPaths().pluginsStatePath;
}

export async function loadPluginStateFile(): Promise<PluginStateFile> {
  const statePath = getPluginStateFilePath();
  if (!(await fileExists(statePath))) {
    return createDefaultPluginStateFile();
  }

  try {
    const raw = await readFileContent(statePath);
    return normalizePluginStateFile(JSON.parse(raw));
  } catch {
    return createDefaultPluginStateFile();
  }
}

export async function savePluginStateFile(state: PluginStateFile): Promise<PluginStateFile> {
  const normalized = normalizePluginStateFile(state);
  const statePath = getPluginStateFilePath();
  await ensureDirectory(path.dirname(statePath));
  await writeFileContent(statePath, `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}

export async function getPluginStateRecord(pluginId: string): Promise<PluginStateRecord> {
  const stateFile = await loadPluginStateFile();
  return stateFile.plugins[pluginId] ?? createDefaultPluginStateRecord();
}

export async function savePluginStateRecord(
  pluginId: string,
  record: PluginStateRecord
): Promise<PluginStateRecord> {
  const stateFile = await loadPluginStateFile();
  stateFile.plugins[pluginId] = normalizePluginStateRecord(record);
  const saved = await savePluginStateFile(stateFile);
  return saved.plugins[pluginId];
}
