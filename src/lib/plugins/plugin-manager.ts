import fs from "fs/promises";
import path from "path";
import {
  getYantraRoots,
  getYantraStorageRoutes,
  readYantraRootsConfig,
  resolveConfiguredVaultPath,
} from "@/lib/config/yantra-roots";
import { getYantraAppPaths } from "@/lib/config/app-paths";
import {
  CURRENT_PLUGIN_CAPABILITY_PHASE,
  getPluginCapabilityDefinition,
  isPluginCapabilityAvailable,
} from "@/lib/plugins/plugin-capabilities";
import {
  getPluginCatalogEntryKey,
  getPluginCatalogEntryToken,
  type PluginCatalogEntryKey,
} from "@/lib/plugins/plugin-entry-key";
import {
  createDefaultPluginStateRecord,
  loadPluginStateFile,
} from "@/lib/plugins/plugin-state-store";
import {
  hashPluginManifest,
  normalizePluginRelativePath,
  PLUGIN_MANIFEST_FILENAME,
  readValidatedPluginDirectory,
  resolvePluginRelativePath,
} from "@/lib/plugins/plugin-manifest";
import { parsePluginVirtualPath } from "@/lib/storage/path-utils";
import { fileExists, listDirectory } from "@/lib/storage/fs-operations";
import type {
  InstalledPluginSummary,
  PluginIssue,
  PluginManifest,
  PluginRuntimeCommand,
  PluginSettingsField,
  PluginSourceInfo,
  PluginStateRecord,
} from "@/types/plugins";

export { hashPluginManifest };

interface CandidatePluginSummary {
  manifest: PluginManifest | null;
  manifestHash: string | null;
  source: PluginSourceInfo;
  stateKey: string | null;
  issues: PluginIssue[];
}

type BundlePluginSummary = InstalledPluginSummary & {
  manifest: PluginManifest & { kind: "bundle" };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function addIssue(
  issues: PluginIssue[],
  code: string,
  message: string,
  severity: PluginIssue["severity"] = "error"
): void {
  issues.push({ code, message, severity });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

async function pathExistsAndIsFile(absPath: string): Promise<boolean> {
  try {
    return (await fs.stat(absPath)).isFile();
  } catch {
    return false;
  }
}

function validateSettingsField(field: unknown, issues: PluginIssue[], index: number): PluginSettingsField | null {
  if (!isRecord(field)) {
    addIssue(issues, "invalid_settings_field", `Settings field #${index + 1} must be an object.`);
    return null;
  }

  if (!isNonEmptyString(field.key)) {
    addIssue(issues, "invalid_settings_field_key", `Settings field #${index + 1} is missing a key.`);
    return null;
  }

  if (!isNonEmptyString(field.label)) {
    addIssue(issues, "invalid_settings_field_label", `Settings field '${field.key}' is missing a label.`);
    return null;
  }

  const type = field.type;
  if (!["text", "textarea", "boolean", "number", "select"].includes(String(type))) {
    addIssue(
      issues,
      "invalid_settings_field_type",
      `Settings field '${field.key}' has unsupported type '${String(type)}'.`
    );
    return null;
  }

  const normalizedType = type as PluginSettingsField["type"];

  const nextField: PluginSettingsField = {
    key: field.key.trim(),
    label: field.label.trim(),
    type: normalizedType,
  };

  if (typeof field.description === "string") {
    nextField.description = field.description;
  }
  if ("default" in field) {
    nextField.default = field.default;
  }
  if (field.secret === true) {
    addIssue(
      issues,
      "secret_settings_not_supported",
      `Settings field '${field.key}' requests secret storage, which is not supported in phase 1.`
    );
    nextField.secret = true;
  }
  if (normalizedType === "select") {
    if (!Array.isArray(field.options)) {
      addIssue(
        issues,
        "missing_select_options",
        `Settings field '${field.key}' must provide options for select fields.`
      );
    } else {
      nextField.options = field.options
        .filter(
          (option): option is { label: string; value: string } =>
            isRecord(option) && isNonEmptyString(option.label) && isNonEmptyString(option.value)
        )
        .map((option) => ({ label: option.label.trim(), value: option.value.trim() }));
      if (nextField.options.length !== field.options.length) {
        addIssue(
          issues,
          "invalid_select_options",
          `Settings field '${field.key}' has one or more invalid select options.`
        );
      }
    }
  }

  return nextField;
}

async function discoverPluginsFromRoot(source: {
  kind: PluginSourceInfo["kind"];
  rootPath: string;
  readonly: boolean;
}): Promise<CandidatePluginSummary[]> {
  if (!(await fileExists(source.rootPath))) {
    return [];
  }

  try {
    const entries = await listDirectory(source.rootPath);
    const candidates = entries.filter((entry) => entry.isDirectory);
    const results: CandidatePluginSummary[] = [];

    for (const candidate of candidates) {
      const pluginPath = path.join(source.rootPath, candidate.name);
      const manifestPath = path.join(pluginPath, PLUGIN_MANIFEST_FILENAME);
      if (!(await fileExists(manifestPath))) {
        continue;
      }

      const pluginSource: PluginSourceInfo = {
        kind: source.kind,
        rootPath: source.rootPath,
        pluginPath,
        readonly: source.readonly,
      };

      const validated = await readValidatedPluginDirectory(pluginPath);
      results.push({
        manifest: validated.manifest,
        manifestHash: validated.manifestHash,
        source: pluginSource,
        stateKey: validated.manifest?.id ?? null,
        issues: validated.issues,
      });
    }

    return results;
  } catch (error) {
    return [
      {
        manifest: null,
        manifestHash: null,
        source: {
          kind: source.kind,
          rootPath: source.rootPath,
          pluginPath: source.rootPath,
          readonly: source.readonly,
        },
        stateKey: null,
        issues: [
          {
            code: "invalid_plugin_root",
            severity: "error",
            message:
              error instanceof Error
                ? `Failed to scan plugin root '${source.rootPath}': ${error.message}`
                : `Failed to scan plugin root '${source.rootPath}'.`,
          },
        ],
      },
    ];
  }
}

function derivePluginStatus(candidate: {
  manifest: PluginManifest | null;
  manifestHash: string | null;
  issues: PluginIssue[];
  state: PluginStateRecord;
}): InstalledPluginSummary["status"] {
  if (!candidate.manifest) {
    return "error";
  }
  if (candidate.issues.some((issue) => issue.severity === "error")) {
    return "error";
  }
  if (!candidate.state.approvedManifestHash || candidate.state.approvedManifestHash !== candidate.manifestHash) {
    return "needs_review";
  }
  const missingRequiredCapabilities = candidate.manifest.requestedCapabilities.required.filter(
    (capability) => !candidate.state.grantedCapabilities.includes(capability)
  );
  if (missingRequiredCapabilities.length > 0) {
    return "disabled";
  }
  return candidate.state.enabled ? "enabled" : "disabled";
}

export async function listInstalledPlugins(): Promise<InstalledPluginSummary[]> {
  const roots = getYantraRoots();
  const rootsConfig = readYantraRootsConfig();
  const storageRoutes = getYantraStorageRoutes(rootsConfig, roots.vaultRoot);
  const vaultPluginsRoot = resolveConfiguredVaultPath(storageRoutes.plugins.path, roots.vaultRoot);
  const localPluginsRoot = getYantraAppPaths().pluginsInstallDir;

  const discovered = [
    ...(await discoverPluginsFromRoot({
      kind: "local-install",
      rootPath: localPluginsRoot,
      readonly: false,
    })),
    ...(await discoverPluginsFromRoot({
      kind: "vault-dev",
      rootPath: vaultPluginsRoot,
      readonly: true,
    })),
  ];

  const duplicateIds = new Set(
    Object.entries(
      discovered.reduce<Record<string, number>>((counts, candidate) => {
        if (candidate.stateKey) {
          counts[candidate.stateKey] = (counts[candidate.stateKey] ?? 0) + 1;
        }
        return counts;
      }, {})
    )
      .filter(([, count]) => count > 1)
      .map(([pluginId]) => pluginId)
  );

  const stateFile = await loadPluginStateFile();

  return discovered
    .map((candidate) => {
      const state =
        candidate.stateKey && !duplicateIds.has(candidate.stateKey)
          ? stateFile.plugins[candidate.stateKey] ?? createDefaultPluginStateRecord()
          : createDefaultPluginStateRecord();

      const issues = [...candidate.issues];
      if (candidate.stateKey && duplicateIds.has(candidate.stateKey)) {
        addIssue(
          issues,
          "duplicate_plugin_id",
          `Plugin id '${candidate.stateKey}' is duplicated across discovery sources.`
        );
      }
      if (
        candidate.manifest &&
        (!state.approvedManifestHash || state.approvedManifestHash !== candidate.manifestHash)
      ) {
        addIssue(
          issues,
          "manifest_review_required",
          "Plugin manifest has not been approved for the current manifest hash.",
          "warning"
        );
      }
      if (candidate.manifest) {
        const missingRequiredCapabilities = candidate.manifest.requestedCapabilities.required.filter(
          (capability) => !state.grantedCapabilities.includes(capability)
        );
        if (missingRequiredCapabilities.length > 0) {
          addIssue(
            issues,
            "missing_required_capabilities",
            `Plugin is missing required granted capabilities: ${missingRequiredCapabilities.join(", ")}.`,
            "warning"
          );
        }
      }

      return {
        manifest: candidate.manifest,
        manifestHash: candidate.manifestHash,
        source: candidate.source,
        state,
        status: derivePluginStatus({
          manifest: candidate.manifest,
          manifestHash: candidate.manifestHash,
          issues,
          state,
        }),
        issues,
      } satisfies InstalledPluginSummary;
    })
    .sort((a, b) => {
      const aKey = a.manifest?.id ?? path.basename(a.source.pluginPath);
      const bKey = b.manifest?.id ?? path.basename(b.source.pluginPath);
      return aKey.localeCompare(bKey);
    });
}

export async function getInstalledPluginById(
  pluginId: string
): Promise<InstalledPluginSummary | null> {
  const plugins = await listInstalledPlugins();
  return plugins.find((plugin) => plugin.manifest?.id === pluginId) ?? null;
}

export async function listEnabledBundlePlugins(): Promise<BundlePluginSummary[]> {
  const plugins = await listInstalledPlugins();
  return plugins.filter(
    (plugin): plugin is BundlePluginSummary =>
      plugin.manifest?.kind === "bundle" &&
      plugin.status === "enabled" &&
      !plugin.issues.some((issue) => issue.severity === "error")
  );
}

export async function listEnabledLauncherOverlayPlugins(): Promise<
  Array<
    BundlePluginSummary & {
      manifest: BundlePluginSummary["manifest"] & {
        bundle: NonNullable<BundlePluginSummary["manifest"]["bundle"]> & {
          overlays: { launchers: string };
        };
      };
    }
  >
> {
  const plugins = await listEnabledBundlePlugins();
  return plugins.filter(
    (
      plugin
    ): plugin is BundlePluginSummary & {
      manifest: BundlePluginSummary["manifest"] & {
        bundle: NonNullable<BundlePluginSummary["manifest"]["bundle"]> & {
          overlays: { launchers: string };
        };
      };
    } => typeof plugin.manifest.bundle?.overlays?.launchers === "string"
  );
}

export async function listEnabledIntegrationOverlayPlugins(): Promise<
  Array<
    BundlePluginSummary & {
      manifest: BundlePluginSummary["manifest"] & {
        bundle: NonNullable<BundlePluginSummary["manifest"]["bundle"]> & {
          overlays: { integrations: string };
        };
      };
    }
  >
> {
  const plugins = await listEnabledBundlePlugins();
  return plugins.filter(
    (
      plugin
    ): plugin is BundlePluginSummary & {
      manifest: BundlePluginSummary["manifest"] & {
        bundle: NonNullable<BundlePluginSummary["manifest"]["bundle"]> & {
          overlays: { integrations: string };
        };
      };
    } => typeof plugin.manifest.bundle?.overlays?.integrations === "string"
  );
}

export async function listEnabledOpenViewCommands(): Promise<PluginRuntimeCommand[]> {
  const plugins = await listInstalledPlugins();
  return plugins
    .filter(
      (plugin): plugin is InstalledPluginSummary & {
        manifest: PluginManifest & {
          kind: "ui-sandbox";
          commands: NonNullable<PluginManifest["commands"]>;
        };
      } => {
        if (plugin.status !== "enabled" || plugin.issues.some((issue) => issue.severity === "error")) {
          return false;
        }
        if (!plugin.manifest || plugin.manifest.kind !== "ui-sandbox") {
          return false;
        }
        return Array.isArray(plugin.manifest.commands) && plugin.manifest.commands.length > 0;
      }
    )
    .flatMap((plugin) => {
      const entryKey = getPluginCatalogEntryKey(plugin);
      return (plugin.manifest.commands ?? []).map((command) => ({
        id: `@plugin/${plugin.manifest.id}/commands/${command.id}`,
        title: command.title,
        pluginId: plugin.manifest.id,
        pluginName: plugin.manifest.name,
        pluginEntryKey: entryKey,
        viewId: command.action.viewId,
      }));
    })
    .sort((left, right) => {
      const pluginCompare = left.pluginName.localeCompare(right.pluginName);
      if (pluginCompare !== 0) return pluginCompare;
      return left.title.localeCompare(right.title);
    });
}

export async function getInstalledPluginByEntryKey(
  entryKey: PluginCatalogEntryKey
): Promise<InstalledPluginSummary | null> {
  const plugins = await listInstalledPlugins();
  return plugins.find((plugin) => getPluginCatalogEntryKey(plugin) === entryKey) ?? null;
}

export async function getInstalledPluginByEntryToken(
  entryToken: string
): Promise<InstalledPluginSummary | null> {
  const plugins = await listInstalledPlugins();
  return (
    plugins.find(
      (plugin) =>
        getPluginCatalogEntryToken(getPluginCatalogEntryKey(plugin)) === entryToken
    ) ?? null
  );
}

function getRuntimeBlockedPluginMessage(plugin: InstalledPluginSummary): string | null {
  if (!plugin.manifest) {
    return "Plugin manifest is invalid.";
  }
  if (plugin.manifest.kind !== "ui-sandbox") {
    return `Plugin kind '${plugin.manifest.kind}' is not hostable in phase 1.`;
  }
  if (plugin.issues.some((issue) => issue.severity === "error")) {
    return `Plugin '${plugin.manifest.id}' has blocking validation issues.`;
  }
  if (plugin.status !== "enabled") {
    return `Plugin '${plugin.manifest.id}' must be enabled before its views can be opened.`;
  }
  return null;
}

export type HostedPluginAssetResolution =
  | {
      ok: true;
      plugin: InstalledPluginSummary & { manifest: PluginManifest };
      entryKey: PluginCatalogEntryKey;
      relativePath: string;
      absolutePath: string;
    }
  | {
      ok: false;
      status: 404 | 409;
      message: string;
    };

export type BundlePluginAssetResolution =
  | {
      ok: true;
      plugin: BundlePluginSummary;
      relativePath: string;
      absolutePath: string;
      contributionKind: "extensions" | "skills" | "skillsets";
    }
  | {
      ok: false;
      status: 404 | 409;
      message: string;
    };

export type HostedPluginViewResolution =
  | {
      ok: true;
      plugin: InstalledPluginSummary & { manifest: PluginManifest };
      view: NonNullable<PluginManifest["views"]>[number];
      entryKey: PluginCatalogEntryKey;
      entryFilePath: string;
    }
  | {
      ok: false;
      status: 404 | 409;
      message: string;
    };

export async function resolveBundlePluginAssetByVirtualPath(input: {
  virtualPath: string;
}): Promise<BundlePluginAssetResolution> {
  const parsed = parsePluginVirtualPath(input.virtualPath);
  if (!parsed) {
    return { ok: false, status: 404, message: "Plugin bundle asset path is invalid." };
  }

  return resolveBundlePluginAsset({
    pluginId: parsed.pluginId,
    relativePath: parsed.relativePath,
  });
}

export async function resolveBundlePluginAsset(input: {
  pluginId: string;
  relativePath: string;
}): Promise<BundlePluginAssetResolution> {
  const plugin = await getInstalledPluginById(input.pluginId);
  const manifest = plugin?.manifest;
  if (!plugin || !manifest) {
    return { ok: false, status: 404, message: "Plugin was not found." };
  }
  if (manifest.kind !== "bundle") {
    return { ok: false, status: 404, message: "Plugin bundle asset was not found." };
  }
  if (plugin.status !== "enabled" || plugin.issues.some((issue) => issue.severity === "error")) {
    return {
      ok: false,
      status: 409,
      message: `Plugin '${manifest.id}' must be enabled before its bundle assets can be used.`,
    };
  }

  const normalizedRelativePath = normalizePluginRelativePath(input.relativePath);
  if (!normalizedRelativePath) {
    return { ok: false, status: 404, message: "Plugin bundle asset path is invalid." };
  }

  const contributionKind = (["extensions", "skills", "skillsets"] as const).find((kind) =>
    manifest.bundle?.[kind]?.includes(normalizedRelativePath)
  );
  if (!contributionKind) {
    return {
      ok: false,
      status: 404,
      message: "Plugin bundle asset was not declared by the manifest.",
    };
  }

  const resolvedPath = resolvePluginRelativePath(plugin.source.pluginPath, normalizedRelativePath);
  if (!resolvedPath || !(await pathExistsAndIsFile(resolvedPath))) {
    return { ok: false, status: 404, message: "Plugin bundle asset was not found." };
  }

  return {
    ok: true,
    plugin: plugin as BundlePluginSummary,
    relativePath: normalizedRelativePath,
    absolutePath: resolvedPath,
    contributionKind,
  };
}

export async function resolveHostedPluginAsset(input: {
  entryToken: string;
  relativePath: string;
}): Promise<HostedPluginAssetResolution> {
  const plugin = await getInstalledPluginByEntryToken(input.entryToken);
  if (!plugin) {
    return { ok: false, status: 404, message: "Plugin was not found." };
  }

  const blockedMessage = getRuntimeBlockedPluginMessage(plugin);
  if (blockedMessage) {
    return { ok: false, status: 409, message: blockedMessage };
  }

  const resolvedPath = resolvePluginRelativePath(plugin.source.pluginPath, input.relativePath);
  if (!resolvedPath) {
    return { ok: false, status: 404, message: "Plugin asset path is invalid." };
  }
  if (!(await pathExistsAndIsFile(resolvedPath))) {
    return { ok: false, status: 404, message: "Plugin asset was not found." };
  }

  return {
    ok: true,
    plugin: plugin as InstalledPluginSummary & { manifest: PluginManifest },
    entryKey: getPluginCatalogEntryKey(plugin),
    relativePath: input.relativePath.replace(/\\/g, "/"),
    absolutePath: resolvedPath,
  };
}

export async function resolveHostedPluginView(input: {
  entryToken: string;
  viewId: string;
}): Promise<HostedPluginViewResolution> {
  const plugin = await getInstalledPluginByEntryToken(input.entryToken);
  if (!plugin) {
    return { ok: false, status: 404, message: "Plugin was not found." };
  }

  const blockedMessage = getRuntimeBlockedPluginMessage(plugin);
  if (blockedMessage) {
    return { ok: false, status: 409, message: blockedMessage };
  }

  const manifest = plugin.manifest;
  if (!manifest) {
    return { ok: false, status: 409, message: "Plugin manifest is invalid." };
  }

  const view = manifest.views?.find((candidate) => candidate.id === input.viewId);
  if (!view) {
    return {
      ok: false,
      status: 404,
      message: `Plugin view '${input.viewId}' was not found.`,
    };
  }

  const asset = await resolveHostedPluginAsset({
    entryToken: input.entryToken,
    relativePath: view.entry,
  });
  if (!asset.ok) {
    return asset;
  }

  return {
    ok: true,
    plugin: asset.plugin,
    view,
    entryKey: asset.entryKey,
    entryFilePath: asset.absolutePath,
  };
}

export function getPluginSettingsDefaults(manifest: PluginManifest): Record<string, unknown> {
  return Object.fromEntries(
    (manifest.settings?.schema?.fields ?? []).map((field) => [field.key, field.default ?? null])
  );
}

export function mergePluginSettingsWithDefaults(
  manifest: PluginManifest,
  settings: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...getPluginSettingsDefaults(manifest),
    ...settings,
  };
}

export function validatePluginSettingsPayload(
  manifest: PluginManifest,
  input: unknown
): { settings: Record<string, unknown>; issues: PluginIssue[] } {
  const issues: PluginIssue[] = [];
  if (!isRecord(input)) {
    addIssue(issues, "invalid_settings_payload", "Plugin settings payload must be an object.");
    return { settings: {}, issues };
  }

  const allowedFields = manifest.settings?.schema?.fields ?? [];
  const allowedKeys = new Set(allowedFields.map((field) => field.key));
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) {
      addIssue(issues, "unknown_settings_key", `Plugin settings key '${key}' is not declared.`);
    }
  }

  const normalized: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (!(field.key in input)) continue;
    const value = input[field.key];
    if (field.type === "boolean") {
      if (typeof value !== "boolean") {
        addIssue(issues, "invalid_settings_value", `Setting '${field.key}' must be a boolean.`);
        continue;
      }
      normalized[field.key] = value;
      continue;
    }
    if (field.type === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        addIssue(issues, "invalid_settings_value", `Setting '${field.key}' must be a finite number.`);
        continue;
      }
      normalized[field.key] = value;
      continue;
    }
    if (typeof value !== "string") {
      addIssue(issues, "invalid_settings_value", `Setting '${field.key}' must be a string.`);
      continue;
    }
    if (field.type === "select" && field.options?.length) {
      const allowedOptions = new Set(field.options.map((option) => option.value));
      if (!allowedOptions.has(value)) {
        addIssue(
          issues,
          "invalid_settings_value",
          `Setting '${field.key}' must be one of: ${field.options.map((option) => option.value).join(", ")}.`
        );
        continue;
      }
    }
    normalized[field.key] = value;
  }

  for (const capability of manifest.requestedCapabilities.required) {
    const definition = getPluginCapabilityDefinition(capability);
    if (!isPluginCapabilityAvailable(capability, CURRENT_PLUGIN_CAPABILITY_PHASE)) {
      addIssue(
        issues,
        "unsupported_capability",
        `Plugin capability '${capability}' is not supported in ${CURRENT_PLUGIN_CAPABILITY_PHASE}.`
      );
    }
    if (definition.requiresTrust === "trusted-local") {
      addIssue(
        issues,
        "trusted_capability_not_supported",
        `Plugin capability '${capability}' requires trusted-local execution, which is not supported in phase 1.`
      );
    }
  }

  return { settings: normalized, issues };
}
