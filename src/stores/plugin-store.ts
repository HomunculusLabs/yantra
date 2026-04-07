import { create } from "zustand";
import { toast } from "sonner";
import {
  getPluginSettings,
  getPluginValidationIssues,
  listPlugins,
  patchPlugin,
  savePluginSettings,
} from "@/lib/api/plugins-client";
import { isRequestJsonError } from "@/lib/api/request-json";
import {
  getPluginCatalogEntryKey,
  type PluginCatalogEntryKey,
} from "@/lib/plugins/plugin-entry-key";
import type { InstalledPluginSummary, PluginCapability, PluginManifest, PluginIssue } from "@/types/plugins";

type PluginPendingOperation =
  | "approve"
  | "enable"
  | "disable"
  | "save_grants"
  | "load_settings"
  | "save_settings"
  | "uninstall";

type PluginCatalogOperation = "install" | null;

type PluginDraftRawValue = string | boolean;

interface PluginSettingsDraft {
  status: "idle" | "loading" | "ready" | "saving" | "error";
  manifestHash: string | null;
  rawValues: Record<string, PluginDraftRawValue>;
  savedRawValues: Record<string, PluginDraftRawValue>;
  fieldErrors: Record<string, string>;
  submitError: string | null;
  validationIssues: PluginIssue[];
}

interface PluginStoreState {
  catalog: InstalledPluginSummary[];
  catalogByEntryKey: Record<PluginCatalogEntryKey, InstalledPluginSummary>;
  selectedPluginKey: PluginCatalogEntryKey | null;
  loading: boolean;
  error: string | null;
  catalogOperation: PluginCatalogOperation;
  requestId: number;
  pendingOperationByEntryKey: Record<PluginCatalogEntryKey, PluginPendingOperation | null>;
  mutationErrorByEntryKey: Record<PluginCatalogEntryKey, string | null>;
  settingsDraftByEntryKey: Record<PluginCatalogEntryKey, PluginSettingsDraft>;
  loadCatalog: () => Promise<void>;
  refreshCatalog: () => Promise<void>;
  installLocalPlugin: () => Promise<void>;
  uninstallLocalPlugin: (entryKey: PluginCatalogEntryKey) => Promise<void>;
  selectPlugin: (entryKey: PluginCatalogEntryKey | null) => void;
  approveManifest: (entryKey: PluginCatalogEntryKey) => Promise<void>;
  setEnabled: (entryKey: PluginCatalogEntryKey, enabled: boolean) => Promise<void>;
  saveGrantedCapabilities: (
    entryKey: PluginCatalogEntryKey,
    grantedCapabilities: PluginCapability[]
  ) => Promise<void>;
  loadSettingsDraft: (entryKey: PluginCatalogEntryKey) => Promise<void>;
  updateSetting: (
    entryKey: PluginCatalogEntryKey,
    key: string,
    rawValue: PluginDraftRawValue
  ) => void;
  resetSettingsDraft: (entryKey: PluginCatalogEntryKey) => void;
  saveSettings: (entryKey: PluginCatalogEntryKey) => Promise<void>;
}

function buildCatalogByEntryKey(
  catalog: InstalledPluginSummary[]
): Record<PluginCatalogEntryKey, InstalledPluginSummary> {
  return Object.fromEntries(
    catalog.map((plugin) => [getPluginCatalogEntryKey(plugin), plugin])
  );
}

function toRawDraftValues(
  manifest: PluginManifest,
  settings: Record<string, unknown>
): Record<string, PluginDraftRawValue> {
  const entries = (manifest.settings?.schema?.fields ?? []).map((field) => {
    const value = settings[field.key];
    if (field.type === "boolean") {
      return [field.key, typeof value === "boolean" ? value : Boolean(value)] as const;
    }
    if (field.type === "number") {
      return [
        field.key,
        typeof value === "number" ? String(value) : typeof value === "string" ? value : "",
      ] as const;
    }
    return [
      field.key,
      typeof value === "string" ? value : value == null ? "" : String(value),
    ] as const;
  });

  return Object.fromEntries(entries);
}

function createIdleDraft(manifestHash: string | null): PluginSettingsDraft {
  return {
    status: "idle",
    manifestHash,
    rawValues: {},
    savedRawValues: {},
    fieldErrors: {},
    submitError: null,
    validationIssues: [],
  };
}

function normalizeCatalog(catalog: InstalledPluginSummary[]): InstalledPluginSummary[] {
  return [...catalog].sort((a, b) => {
    const aKey = a.manifest?.name ?? a.manifest?.id ?? a.source.pluginPath;
    const bKey = b.manifest?.name ?? b.manifest?.id ?? b.source.pluginPath;
    return aKey.localeCompare(bKey);
  });
}

async function refreshSinglePlugin(
  entryKey: PluginCatalogEntryKey
): Promise<InstalledPluginSummary | null> {
  const catalog = await listPlugins();
  return catalog.find((plugin) => getPluginCatalogEntryKey(plugin) === entryKey) ?? null;
}

function pickRecordEntries<T>(
  record: Record<string, T>,
  validKeys: Set<string>
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => validKeys.has(key))
  );
}

function replaceCatalogEntry(
  catalog: InstalledPluginSummary[],
  entryKey: PluginCatalogEntryKey,
  nextPlugin: InstalledPluginSummary
): InstalledPluginSummary[] {
  return catalog.map((entry) =>
    getPluginCatalogEntryKey(entry) === entryKey ? nextPlugin : entry
  );
}

function hasPluginIssue(
  plugin: InstalledPluginSummary | null | undefined,
  code: string
): boolean {
  return Boolean(plugin?.issues.some((issue) => issue.code === code));
}

function getDuplicateIdGuardMessage(plugin: InstalledPluginSummary): string {
  return `Cannot manage ${plugin.manifest?.name ?? plugin.manifest?.id ?? "this plugin"} while duplicate plugin IDs are present.`;
}

function setPluginPending(
  setState: (
    partial:
      | Partial<PluginStoreState>
      | ((state: PluginStoreState) => Partial<PluginStoreState>)
  ) => void,
  entryKey: PluginCatalogEntryKey,
  pending: PluginPendingOperation | null,
  error: string | null = null
) {
  setState((state) => ({
    pendingOperationByEntryKey: {
      ...state.pendingOperationByEntryKey,
      [entryKey]: pending,
    },
    mutationErrorByEntryKey: {
      ...state.mutationErrorByEntryKey,
      [entryKey]: error,
    },
  }));
}

export const usePluginStore = create<PluginStoreState>((set, get) => ({
  catalog: [],
  catalogByEntryKey: {},
  selectedPluginKey: null,
  loading: false,
  error: null,
  catalogOperation: null,
  requestId: 0,
  pendingOperationByEntryKey: {},
  mutationErrorByEntryKey: {},
  settingsDraftByEntryKey: {},

  loadCatalog: async () => {
    const requestId = get().requestId + 1;
    set({ loading: true, error: null, requestId });
    try {
      const catalog = normalizeCatalog(await listPlugins());
      if (get().requestId !== requestId) return;
      const catalogByEntryKey = buildCatalogByEntryKey(catalog);
      const validKeys = new Set(Object.keys(catalogByEntryKey));
      const currentSelectedPluginKey = get().selectedPluginKey;
      const selectedPluginKey =
        currentSelectedPluginKey && catalogByEntryKey[currentSelectedPluginKey]
          ? currentSelectedPluginKey
          : catalog[0]
            ? getPluginCatalogEntryKey(catalog[0])
            : null;
      set((state) => ({
        catalog,
        catalogByEntryKey,
        selectedPluginKey,
        loading: false,
        error: null,
        pendingOperationByEntryKey: pickRecordEntries(
          state.pendingOperationByEntryKey,
          validKeys
        ),
        mutationErrorByEntryKey: pickRecordEntries(
          state.mutationErrorByEntryKey,
          validKeys
        ),
        settingsDraftByEntryKey: pickRecordEntries(
          state.settingsDraftByEntryKey,
          validKeys
        ),
      }));
    } catch (error) {
      if (get().requestId !== requestId) return;
      set({
        loading: false,
        error: error instanceof Error ? error.message : "Failed to load plugins",
      });
    }
  },

  refreshCatalog: async () => {
    await get().loadCatalog();
  },

  installLocalPlugin: async () => {
    if (typeof window === "undefined" || !window.yantraDesktop?.installPluginFromDirectory) {
      const message = "Plugin install is only available in the desktop app.";
      set({ error: message });
      toast.error(message);
      return;
    }

    if (get().catalogOperation) return;
    set({ catalogOperation: "install", error: null });

    try {
      const result = await window.yantraDesktop.installPluginFromDirectory();
      if (!result) {
        set({ catalogOperation: null });
        return;
      }

      await get().loadCatalog();
      const installedPlugin = get().catalog.find(
        (plugin) =>
          plugin.source.kind === "local-install" &&
          plugin.source.pluginPath === result.installedPath
      );
      if (installedPlugin) {
        set({ selectedPluginKey: getPluginCatalogEntryKey(installedPlugin) });
      }
      toast.success(`Installed ${result.pluginName}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to install plugin.";
      set({ error: message });
      toast.error(message);
    } finally {
      set({ catalogOperation: null });
    }
  },

  uninstallLocalPlugin: async (entryKey) => {
    const plugin = get().catalogByEntryKey[entryKey];
    if (!plugin) return;
    if (plugin.source.kind !== "local-install") {
      const message = "Only local-install plugins can be removed from the desktop app.";
      setPluginPending(set, entryKey, null, message);
      toast.error(message);
      return;
    }
    if (typeof window === "undefined" || !window.yantraDesktop?.uninstallPlugin) {
      const message = "Plugin uninstall is only available in the desktop app.";
      setPluginPending(set, entryKey, null, message);
      toast.error(message);
      return;
    }
    if (get().pendingOperationByEntryKey[entryKey]) return;

    setPluginPending(set, entryKey, "uninstall");
    try {
      const result = await window.yantraDesktop.uninstallPlugin({
        pluginPath: plugin.source.pluginPath,
        pluginId: plugin.manifest?.id ?? null,
      });
      await get().loadCatalog();
      toast.success(
        `Removed ${plugin.manifest?.name ?? result.pluginId ?? "local plugin"}.`
      );
      setPluginPending(set, entryKey, null, null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to uninstall plugin.";
      setPluginPending(set, entryKey, null, message);
      toast.error(message);
    }
  },

  selectPlugin: (entryKey) => set({ selectedPluginKey: entryKey }),

  approveManifest: async (entryKey) => {
    const plugin = get().catalogByEntryKey[entryKey];
    const pluginId = plugin?.manifest?.id;
    if (!pluginId) return;
    if (hasPluginIssue(plugin, "duplicate_plugin_id")) {
      setPluginPending(set, entryKey, null, getDuplicateIdGuardMessage(plugin));
      return;
    }
    if (get().pendingOperationByEntryKey[entryKey]) return;
    setPluginPending(set, entryKey, "approve");
    try {
      const refreshedPlugin = await patchPlugin(pluginId, { approveManifest: true });
      set((state) => ({
        catalog: replaceCatalogEntry(state.catalog, entryKey, refreshedPlugin),
        catalogByEntryKey: {
          ...state.catalogByEntryKey,
          [entryKey]: refreshedPlugin,
        },
      }));
      toast.success(`Approved manifest for ${refreshedPlugin.manifest?.name ?? pluginId}.`);
    } catch (error) {
      if (isRequestJsonError(error) && (error.status === 404 || error.status === 409)) {
        await get().refreshCatalog();
      }
      const message = error instanceof Error ? error.message : `Failed to approve ${pluginId}`;
      setPluginPending(set, entryKey, null, message);
      toast.error(message);
      return;
    }
    setPluginPending(set, entryKey, null, null);
  },

  setEnabled: async (entryKey, enabled) => {
    const plugin = get().catalogByEntryKey[entryKey];
    const pluginId = plugin?.manifest?.id;
    if (!pluginId) return;
    if (hasPluginIssue(plugin, "duplicate_plugin_id")) {
      setPluginPending(set, entryKey, null, getDuplicateIdGuardMessage(plugin));
      return;
    }
    if (get().pendingOperationByEntryKey[entryKey]) return;
    setPluginPending(set, entryKey, enabled ? "enable" : "disable");
    try {
      const refreshedPlugin = await patchPlugin(pluginId, { enabled });
      set((state) => ({
        catalog: replaceCatalogEntry(state.catalog, entryKey, refreshedPlugin),
        catalogByEntryKey: {
          ...state.catalogByEntryKey,
          [entryKey]: refreshedPlugin,
        },
      }));
      toast.success(`${enabled ? "Enabled" : "Disabled"} ${refreshedPlugin.manifest?.name ?? pluginId}.`);
    } catch (error) {
      if (isRequestJsonError(error) && (error.status === 404 || error.status === 409)) {
        await get().refreshCatalog();
      }
      const message = error instanceof Error ? error.message : `Failed to update ${pluginId}`;
      setPluginPending(set, entryKey, null, message);
      toast.error(message);
      return;
    }
    setPluginPending(set, entryKey, null, null);
  },

  saveGrantedCapabilities: async (entryKey, grantedCapabilities) => {
    const plugin = get().catalogByEntryKey[entryKey];
    const pluginId = plugin?.manifest?.id;
    if (!pluginId) return;
    if (hasPluginIssue(plugin, "duplicate_plugin_id")) {
      setPluginPending(set, entryKey, null, getDuplicateIdGuardMessage(plugin));
      return;
    }
    if (get().pendingOperationByEntryKey[entryKey]) return;
    setPluginPending(set, entryKey, "save_grants");
    try {
      const refreshedPlugin = await patchPlugin(pluginId, { grantedCapabilities });
      set((state) => ({
        catalog: replaceCatalogEntry(state.catalog, entryKey, refreshedPlugin),
        catalogByEntryKey: {
          ...state.catalogByEntryKey,
          [entryKey]: refreshedPlugin,
        },
      }));
      toast.success(`Saved capability grants for ${refreshedPlugin.manifest?.name ?? pluginId}.`);
    } catch (error) {
      if (isRequestJsonError(error) && (error.status === 404 || error.status === 409)) {
        await get().refreshCatalog();
      }
      const message =
        error instanceof Error ? error.message : `Failed to save grants for ${pluginId}`;
      setPluginPending(set, entryKey, null, message);
      toast.error(message);
      return;
    }
    setPluginPending(set, entryKey, null, null);
  },

  loadSettingsDraft: async (entryKey) => {
    const plugin = get().catalogByEntryKey[entryKey];
    if (!plugin?.manifest) return;
    if (hasPluginIssue(plugin, "duplicate_plugin_id")) {
      const submitError = getDuplicateIdGuardMessage(plugin);
      set((state) => ({
        settingsDraftByEntryKey: {
          ...state.settingsDraftByEntryKey,
          [entryKey]: {
            ...(state.settingsDraftByEntryKey[entryKey] ?? createIdleDraft(plugin.manifestHash ?? null)),
            status: "error",
            submitError,
            validationIssues: [],
          },
        },
      }));
      return;
    }
    const manifest = plugin.manifest;
    const existing = get().settingsDraftByEntryKey[entryKey];
    if (
      existing &&
      existing.status === "ready" &&
      existing.manifestHash === (plugin.manifestHash ?? null)
    ) {
      return;
    }
    if (get().pendingOperationByEntryKey[entryKey]) return;

    setPluginPending(set, entryKey, "load_settings");
    set((state) => ({
      settingsDraftByEntryKey: {
        ...state.settingsDraftByEntryKey,
        [entryKey]: {
          ...(state.settingsDraftByEntryKey[entryKey] ?? createIdleDraft(plugin.manifestHash ?? null)),
          status: "loading",
          submitError: null,
          validationIssues: [],
        },
      },
    }));

    try {
      const response = await getPluginSettings(manifest.id);
      const rawValues = toRawDraftValues(manifest, response.settings);
      set((state) => ({
        settingsDraftByEntryKey: {
          ...state.settingsDraftByEntryKey,
          [entryKey]: {
            status: "ready",
            manifestHash: plugin.manifestHash ?? null,
            rawValues,
            savedRawValues: rawValues,
            fieldErrors: {},
            submitError: null,
            validationIssues: [],
          },
        },
      }));
    } catch (error) {
      if (isRequestJsonError(error) && (error.status === 404 || error.status === 409)) {
        await get().refreshCatalog();
      }
      set((state) => ({
        settingsDraftByEntryKey: {
          ...state.settingsDraftByEntryKey,
          [entryKey]: {
            ...(state.settingsDraftByEntryKey[entryKey] ?? createIdleDraft(plugin.manifestHash ?? null)),
            status: "error",
            submitError:
              error instanceof Error
                ? error.message
                : `Failed to load settings for ${manifest.id}`,
          },
        },
      }));
    }
    setPluginPending(set, entryKey, null, null);
  },

  updateSetting: (entryKey, key, rawValue) => {
    set((state) => {
      const draft = state.settingsDraftByEntryKey[entryKey] ?? createIdleDraft(null);
      const nextFieldErrors = { ...draft.fieldErrors };
      delete nextFieldErrors[key];
      return {
        settingsDraftByEntryKey: {
          ...state.settingsDraftByEntryKey,
          [entryKey]: {
            ...draft,
            status: draft.status === "idle" ? "ready" : draft.status,
            rawValues: {
              ...draft.rawValues,
              [key]: rawValue,
            },
            fieldErrors: nextFieldErrors,
            submitError: null,
            validationIssues: [],
          },
        },
      };
    });
  },

  resetSettingsDraft: (entryKey) => {
    set((state) => {
      const draft = state.settingsDraftByEntryKey[entryKey];
      if (!draft) return state;
      return {
        settingsDraftByEntryKey: {
          ...state.settingsDraftByEntryKey,
          [entryKey]: {
            ...draft,
            rawValues: draft.savedRawValues,
            fieldErrors: {},
            submitError: null,
            validationIssues: [],
          },
        },
      };
    });
  },

  saveSettings: async (entryKey) => {
    const plugin = get().catalogByEntryKey[entryKey];
    if (!plugin?.manifest) return;
    if (hasPluginIssue(plugin, "duplicate_plugin_id")) {
      setPluginPending(set, entryKey, null, getDuplicateIdGuardMessage(plugin));
      return;
    }
    const manifest = plugin.manifest;
    if (get().pendingOperationByEntryKey[entryKey]) return;

    const draft = get().settingsDraftByEntryKey[entryKey];
    if (!draft) return;

    const payload: Record<string, unknown> = {};
    const fieldErrors: Record<string, string> = {};
    for (const field of manifest.settings?.schema?.fields ?? []) {
      const rawValue = draft.rawValues[field.key];
      if (field.type === "boolean") {
        payload[field.key] = Boolean(rawValue);
        continue;
      }
      if (field.type === "number") {
        const raw = typeof rawValue === "string" ? rawValue.trim() : "";
        if (!raw) {
          continue;
        }
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) {
          fieldErrors[field.key] = "Enter a valid number.";
          continue;
        }
        payload[field.key] = parsed;
        continue;
      }
      payload[field.key] = typeof rawValue === "string" ? rawValue : "";
    }

    if (Object.keys(fieldErrors).length > 0) {
      set((state) => ({
        settingsDraftByEntryKey: {
          ...state.settingsDraftByEntryKey,
          [entryKey]: {
            ...draft,
            fieldErrors,
            submitError: "Fix the highlighted settings fields before saving.",
          },
        },
      }));
      return;
    }

    setPluginPending(set, entryKey, "save_settings");
    set((state) => ({
      settingsDraftByEntryKey: {
        ...state.settingsDraftByEntryKey,
        [entryKey]: {
          ...draft,
          status: "saving",
          fieldErrors: {},
          submitError: null,
          validationIssues: [],
        },
      },
    }));

    try {
      const response = await savePluginSettings(manifest.id, payload);
      const refreshedPlugin =
        (await refreshSinglePlugin(entryKey)) ?? get().catalogByEntryKey[entryKey];
      const rawValues = refreshedPlugin?.manifest
        ? toRawDraftValues(refreshedPlugin.manifest, response.settings)
        : draft.rawValues;
      set((state) => ({
        catalog: refreshedPlugin
          ? replaceCatalogEntry(state.catalog, entryKey, refreshedPlugin)
          : state.catalog,
        catalogByEntryKey: refreshedPlugin
          ? { ...state.catalogByEntryKey, [entryKey]: refreshedPlugin }
          : state.catalogByEntryKey,
        settingsDraftByEntryKey: {
          ...state.settingsDraftByEntryKey,
          [entryKey]: {
            status: "ready",
            manifestHash: refreshedPlugin?.manifestHash ?? draft.manifestHash,
            rawValues,
            savedRawValues: rawValues,
            fieldErrors: {},
            submitError: null,
            validationIssues: [],
          },
        },
      }));
      toast.success(`Saved settings for ${refreshedPlugin?.manifest?.name ?? manifest.id}.`);
    } catch (error) {
      if (isRequestJsonError(error) && (error.status === 404 || error.status === 409)) {
        await get().refreshCatalog();
      }
      set((state) => ({
        settingsDraftByEntryKey: {
          ...state.settingsDraftByEntryKey,
          [entryKey]: {
            ...draft,
            status: "error",
            submitError:
              error instanceof Error
                ? error.message
                : `Failed to save settings for ${manifest.id}`,
            validationIssues: getPluginValidationIssues(error),
          },
        },
      }));
      toast.error(
        error instanceof Error
          ? error.message
          : `Failed to save settings for ${manifest.id}`
      );
      setPluginPending(
        set,
        entryKey,
        null,
        error instanceof Error ? error.message : "Save failed"
      );
      return;
    }

    setPluginPending(set, entryKey, null, null);
  },
}));
