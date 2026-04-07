import { createHash } from "crypto";
import fs from "fs/promises";
import path from "path";
import {
  CURRENT_PLUGIN_CAPABILITY_PHASE,
  isPluginCapability,
  isPluginCapabilityAvailable,
} from "@/lib/plugins/plugin-capabilities";
import { fileExists, readFileContent } from "@/lib/storage/fs-operations";
import type {
  PluginBundleContributions,
  PluginCapability,
  PluginIssue,
  PluginKind,
  PluginManifest,
  PluginSettingsField,
} from "@/types/plugins";

export const PLUGIN_MANIFEST_FILENAME = "plugin.json";
export const SUPPORTED_PLUGIN_KINDS = new Set<PluginKind>(["ui-sandbox", "bundle"]);

const BUNDLE_EXTENSION_FILE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts"]);

export interface ValidatedPluginDirectory {
  manifest: PluginManifest | null;
  manifestHash: string | null;
  issues: PluginIssue[];
}

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

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}

function sortOptionalStrings(values?: string[]): string[] | undefined {
  if (!values?.length) return undefined;
  return [...values].sort((a, b) => a.localeCompare(b));
}

function toCanonicalManifestForHash(manifest: PluginManifest): PluginManifest {
  return {
    ...manifest,
    requestedCapabilities: {
      required: [...manifest.requestedCapabilities.required].sort((a, b) => a.localeCompare(b)),
      optional: [...manifest.requestedCapabilities.optional].sort((a, b) => a.localeCompare(b)),
    },
    bundle: manifest.bundle
      ? {
          extensions: sortOptionalStrings(manifest.bundle.extensions),
          skills: sortOptionalStrings(manifest.bundle.skills),
          skillsets: sortOptionalStrings(manifest.bundle.skillsets),
          overlays: manifest.bundle.overlays
            ? {
                launchers: manifest.bundle.overlays.launchers,
                integrations: manifest.bundle.overlays.integrations,
              }
            : undefined,
        }
      : undefined,
  };
}

export function hashPluginManifest(manifest: PluginManifest): string {
  return createHash("sha256")
    .update(stableStringify(toCanonicalManifestForHash(manifest)))
    .digest("hex");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function ensureUniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function parseCapabilityArray(
  value: unknown,
  fieldName: string,
  issues: PluginIssue[]
): string[] | null {
  if (!Array.isArray(value)) {
    addIssue(
      issues,
      "invalid_capability_array",
      `Plugin requestedCapabilities.${fieldName} must be an array of strings.`
    );
    return null;
  }

  if (!value.every((item) => typeof item === "string")) {
    addIssue(
      issues,
      "invalid_capability_value",
      `Plugin requestedCapabilities.${fieldName} must contain only strings.`
    );
    return null;
  }

  const normalized = value.map((item) => item.trim()).filter(Boolean);
  if (normalized.length !== value.length) {
    addIssue(
      issues,
      "invalid_capability_value",
      `Plugin requestedCapabilities.${fieldName} cannot contain empty capability values.`
    );
    return null;
  }

  const duplicates = normalized.filter(
    (capability, index) => normalized.indexOf(capability) !== index
  );
  if (duplicates.length > 0) {
    addIssue(
      issues,
      "duplicate_capability",
      `Plugin requestedCapabilities.${fieldName} contains duplicates: ${[
        ...new Set(duplicates),
      ].join(", ")}.`
    );
  }

  return ensureUniqueStrings(normalized);
}

export function normalizePluginRelativePath(relativePath: string): string | null {
  if (typeof relativePath !== "string") return null;
  const trimmed = relativePath.trim();
  if (!trimmed || path.isAbsolute(trimmed)) return null;
  const normalized = path.posix
    .normalize(trimmed.replace(/\\/g, "/").replace(/^\.\//, ""))
    .replace(/^\/+/, "");
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized === "..") {
    return null;
  }
  return normalized;
}

export function isSafePluginRelativePath(relativePath: string): boolean {
  return normalizePluginRelativePath(relativePath) !== null;
}

export function resolvePluginRelativePath(
  pluginRoot: string,
  relativePath: string
): string | null {
  const normalizedRelativePath = normalizePluginRelativePath(relativePath);
  if (!normalizedRelativePath) return null;
  const resolvedRoot = path.resolve(pluginRoot);
  const resolvedPath = path.resolve(pluginRoot, normalizedRelativePath);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    return null;
  }
  return resolvedPath;
}

export function isHtmlPluginEntry(relativePath: string): boolean {
  const extension = path.extname(relativePath).toLowerCase();
  return extension === ".html" || extension === ".htm";
}

async function pathExistsAndIsFile(absPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(absPath);
    return stats.isFile();
  } catch {
    return false;
  }
}

function validateSettingsField(
  field: unknown,
  issues: PluginIssue[],
  index: number
): PluginSettingsField | null {
  if (!isRecord(field)) {
    addIssue(issues, "invalid_settings_field", `Settings field #${index + 1} must be an object.`);
    return null;
  }

  if (!isNonEmptyString(field.key)) {
    addIssue(issues, "invalid_settings_field_key", `Settings field #${index + 1} is missing a key.`);
    return null;
  }

  if (!isNonEmptyString(field.label)) {
    addIssue(
      issues,
      "invalid_settings_field_label",
      `Settings field '${field.key}' is missing a label.`
    );
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

function normalizeBundleContributionList(
  value: unknown,
  fieldName: keyof PluginBundleContributions,
  issues: PluginIssue[]
): string[] | null {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    addIssue(
      issues,
      "invalid_bundle_contribution_array",
      `Plugin bundle.${fieldName} must be an array of relative file paths.`
    );
    return null;
  }

  const normalized: string[] = [];
  for (const [index, item] of value.entries()) {
    if (!isNonEmptyString(item)) {
      addIssue(
        issues,
        "invalid_bundle_contribution_value",
        `Plugin bundle.${fieldName}[${index}] must be a non-empty string.`
      );
      continue;
    }

    const relativePath = normalizePluginRelativePath(item);
    if (!relativePath) {
      addIssue(
        issues,
        "invalid_bundle_contribution_path",
        `Plugin bundle.${fieldName}[${index}] has an invalid relative path '${String(item)}'.`
      );
      continue;
    }

    normalized.push(relativePath);
  }

  const duplicatePaths = normalized.filter(
    (relativePath, index) => normalized.indexOf(relativePath) !== index
  );
  if (duplicatePaths.length > 0) {
    addIssue(
      issues,
      "duplicate_bundle_contribution",
      `Plugin bundle.${fieldName} contains duplicates: ${[
        ...new Set(duplicatePaths),
      ].join(", ")}.`
    );
  }

  return ensureUniqueStrings(normalized);
}

function hasBundleContributions(bundle?: PluginBundleContributions): boolean {
  return Boolean(
    bundle?.extensions?.length ||
      bundle?.skills?.length ||
      bundle?.skillsets?.length ||
      bundle?.overlays?.launchers ||
      bundle?.overlays?.integrations
  );
}

function getBundleContributionExtensionKind(
  contributionKind: keyof PluginBundleContributions,
  relativePath: string
): boolean {
  const extension = path.extname(relativePath).toLowerCase();
  if (contributionKind === "extensions") {
    return BUNDLE_EXTENSION_FILE_EXTENSIONS.has(extension);
  }
  return extension === ".md";
}

export function validatePluginManifest(
  input: unknown,
  pluginRoot: string
): {
  manifest: PluginManifest | null;
  issues: PluginIssue[];
} {
  const issues: PluginIssue[] = [];

  if (!isRecord(input)) {
    addIssue(issues, "invalid_manifest", "Plugin manifest must be a JSON object.");
    return { manifest: null, issues };
  }

  if (!isNonEmptyString(input.id) || /[\\/]/.test(input.id)) {
    addIssue(issues, "invalid_plugin_id", "Plugin manifest must include a valid id.");
  }
  if (!isNonEmptyString(input.name)) {
    addIssue(issues, "invalid_plugin_name", "Plugin manifest must include a name.");
  }
  if (!isNonEmptyString(input.version)) {
    addIssue(issues, "invalid_plugin_version", "Plugin manifest must include a version.");
  }
  if (input.apiVersion !== 1) {
    addIssue(issues, "unsupported_api_version", "Plugin apiVersion must be 1.");
  }

  const kind = input.kind;
  if (kind !== "ui-sandbox" && kind !== "bundle" && kind !== "trusted-sidecar") {
    addIssue(issues, "invalid_plugin_kind", `Plugin kind '${String(kind)}' is not recognized.`);
  } else if (!SUPPORTED_PLUGIN_KINDS.has(kind)) {
    addIssue(
      issues,
      "unsupported_plugin_kind",
      `Plugin kind '${kind}' is not supported in phase 1.`
    );
  }

  const requestedCapabilities = isRecord(input.requestedCapabilities)
    ? input.requestedCapabilities
    : null;
  if (!requestedCapabilities) {
    addIssue(
      issues,
      "invalid_requested_capabilities",
      "Plugin manifest must include requestedCapabilities.required and requestedCapabilities.optional arrays."
    );
  }

  const required = parseCapabilityArray(requestedCapabilities?.required, "required", issues) ?? [];
  const optional = parseCapabilityArray(requestedCapabilities?.optional, "optional", issues) ?? [];
  const overlapping = required.filter((capability) => optional.includes(capability));
  if (overlapping.length > 0) {
    addIssue(
      issues,
      "overlapping_capabilities",
      `Capabilities cannot appear in both required and optional: ${overlapping.join(", ")}.`
    );
  }

  const uniqueCapabilities = [...required, ...optional].filter(
    (capability, index, array) => array.indexOf(capability) === index
  );
  for (const capability of uniqueCapabilities) {
    if (!isPluginCapability(capability)) {
      addIssue(issues, "unknown_capability", `Plugin capability '${capability}' is not recognized.`);
      continue;
    }
    if (!isPluginCapabilityAvailable(capability, CURRENT_PLUGIN_CAPABILITY_PHASE)) {
      addIssue(
        issues,
        "unsupported_capability",
        `Plugin capability '${capability}' is not supported in ${CURRENT_PLUGIN_CAPABILITY_PHASE}.`
      );
    }
  }

  if ("views" in input && !Array.isArray(input.views)) {
    addIssue(issues, "invalid_views_container", "Plugin views must be an array when provided.");
  }
  const viewsInput = Array.isArray(input.views) ? input.views : [];
  const views: NonNullable<PluginManifest["views"]> = [];
  const viewIds = new Set<string>();
  for (const [index, view] of viewsInput.entries()) {
    if (!isRecord(view)) {
      addIssue(issues, "invalid_view", `View #${index + 1} must be an object.`);
      continue;
    }
    if (!isNonEmptyString(view.id)) {
      addIssue(issues, "invalid_view_id", `View #${index + 1} is missing an id.`);
      continue;
    }
    if (viewIds.has(view.id)) {
      addIssue(issues, "duplicate_view_id", `View id '${view.id}' is duplicated.`);
      continue;
    }
    viewIds.add(view.id);
    if (!isNonEmptyString(view.title)) {
      addIssue(issues, "invalid_view_title", `View '${view.id}' is missing a title.`);
      continue;
    }
    if (view.slot !== "workspace") {
      addIssue(issues, "invalid_view_slot", `View '${view.id}' must use slot 'workspace'.`);
      continue;
    }
    if (!isNonEmptyString(view.entry)) {
      addIssue(issues, "invalid_view_entry", `View '${view.id}' is missing an entry path.`);
      continue;
    }
    const resolvedEntry = resolvePluginRelativePath(pluginRoot, view.entry);
    if (!resolvedEntry) {
      addIssue(
        issues,
        "invalid_view_entry",
        `View '${view.id}' has an invalid entry path '${view.entry}'.`
      );
      continue;
    }
    views.push({
      id: view.id.trim(),
      title: view.title.trim(),
      slot: "workspace",
      entry: view.entry.replace(/\\/g, "/"),
    });
  }

  if ("commands" in input && !Array.isArray(input.commands)) {
    addIssue(
      issues,
      "invalid_commands_container",
      "Plugin commands must be an array when provided."
    );
  }
  const commandsInput = Array.isArray(input.commands) ? input.commands : [];
  const commands: NonNullable<PluginManifest["commands"]> = [];
  const commandIds = new Set<string>();
  for (const [index, command] of commandsInput.entries()) {
    if (!isRecord(command)) {
      addIssue(issues, "invalid_command", `Command #${index + 1} must be an object.`);
      continue;
    }
    if (!isNonEmptyString(command.id)) {
      addIssue(issues, "invalid_command_id", `Command #${index + 1} is missing an id.`);
      continue;
    }
    const commandId = command.id.trim();
    if (commandIds.has(commandId)) {
      addIssue(issues, "duplicate_command_id", `Command id '${commandId}' is duplicated.`);
      continue;
    }
    commandIds.add(commandId);
    if (!isNonEmptyString(command.title)) {
      addIssue(issues, "invalid_command_title", `Command '${commandId}' is missing a title.`);
      continue;
    }
    const action = isRecord(command.action) ? command.action : null;
    if (!action || action.type !== "open_view" || !isNonEmptyString(action.viewId)) {
      addIssue(
        issues,
        "invalid_command_action",
        `Command '${commandId}' must use an open_view action with a valid viewId.`
      );
      continue;
    }
    if (!views.some((view) => view.id === action.viewId)) {
      addIssue(
        issues,
        "unknown_command_view",
        `Command '${commandId}' references missing view '${action.viewId}'.`
      );
      continue;
    }
    commands.push({
      id: commandId,
      title: command.title.trim(),
      action: { type: "open_view", viewId: action.viewId.trim() },
    });
  }

  let settings: PluginManifest["settings"] | undefined;
  if ("settings" in input) {
    if (!isRecord(input.settings)) {
      addIssue(issues, "invalid_settings", "Plugin settings must be an object when provided.");
    } else {
      const settingsInput = input.settings;
      if (
        "schema" in settingsInput &&
        settingsInput.schema !== undefined &&
        !isRecord(settingsInput.schema)
      ) {
        addIssue(
          issues,
          "invalid_settings_schema",
          "Plugin settings.schema must be an object when provided."
        );
      }
      const schemaInput = isRecord(settingsInput.schema) ? settingsInput.schema : null;
      if (schemaInput && "fields" in schemaInput && !Array.isArray(schemaInput.fields)) {
        addIssue(
          issues,
          "invalid_settings_fields",
          "Plugin settings.schema.fields must be an array when provided."
        );
      }
      const fieldsInput = Array.isArray(schemaInput?.fields) ? schemaInput.fields : [];
      const fields = fieldsInput
        .map((field: unknown, index: number) => validateSettingsField(field, issues, index))
        .filter((field): field is PluginSettingsField => Boolean(field));
      const fieldKeys = fields.map((field) => field.key);
      const duplicateFieldKeys = fieldKeys.filter((key, index) => fieldKeys.indexOf(key) !== index);
      if (duplicateFieldKeys.length > 0) {
        addIssue(
          issues,
          "duplicate_settings_field",
          `Settings field keys must be unique: ${[...new Set(duplicateFieldKeys)].join(", ")}.`
        );
      }

      settings = {};
      if (fields.length > 0 || Array.isArray(schemaInput?.fields)) {
        settings.schema = { fields };
      }
      if (typeof settingsInput.entry === "string") {
        settings.entry = settingsInput.entry.replace(/\\/g, "/");
        addIssue(
          issues,
          "settings_entry_not_supported",
          "Custom plugin settings entry points are not supported in phase 1."
        );
        if (!resolvePluginRelativePath(pluginRoot, settingsInput.entry)) {
          addIssue(
            issues,
            "invalid_settings_entry",
            `Plugin settings entry path '${settingsInput.entry}' is invalid.`
          );
        }
      }
      if (!settings.schema && !settings.entry) {
        settings = undefined;
      }
    }
  }

  let bundle: PluginBundleContributions | undefined;
  if ("bundle" in input) {
    if (!isRecord(input.bundle)) {
      addIssue(
        issues,
        "invalid_bundle_contributions",
        "Plugin bundle contributions must be an object when provided."
      );
    } else {
      const extensions =
        normalizeBundleContributionList(input.bundle.extensions, "extensions", issues) ?? [];
      const skills = normalizeBundleContributionList(input.bundle.skills, "skills", issues) ?? [];
      const skillsets =
        normalizeBundleContributionList(input.bundle.skillsets, "skillsets", issues) ?? [];
      bundle = {};
      if (extensions.length > 0 || Array.isArray(input.bundle.extensions)) {
        bundle.extensions = extensions;
      }
      if (skills.length > 0 || Array.isArray(input.bundle.skills)) {
        bundle.skills = skills;
      }
      if (skillsets.length > 0 || Array.isArray(input.bundle.skillsets)) {
        bundle.skillsets = skillsets;
      }
      if (isRecord(input.bundle.overlays)) {
        const normalizedOverlays: NonNullable<PluginBundleContributions["overlays"]> = {};
        const launchersPath = input.bundle.overlays.launchers;
        if (launchersPath !== undefined) {
          if (!isNonEmptyString(launchersPath)) {
            addIssue(
              issues,
              "invalid_bundle_overlay_path",
              "Plugin bundle.overlays.launchers must be a non-empty relative JSON file path."
            );
          } else {
            const normalizedLaunchersPath = normalizePluginRelativePath(launchersPath);
            if (!normalizedLaunchersPath || path.extname(normalizedLaunchersPath).toLowerCase() !== ".json") {
              addIssue(
                issues,
                "invalid_bundle_overlay_path",
                `Plugin bundle.overlays.launchers must point to a plugin-relative JSON file. Received '${launchersPath}'.`
              );
            } else {
              normalizedOverlays.launchers = normalizedLaunchersPath;
            }
          }
        }
        const integrationsPath = input.bundle.overlays.integrations;
        if (integrationsPath !== undefined) {
          if (!isNonEmptyString(integrationsPath)) {
            addIssue(
              issues,
              "invalid_bundle_overlay_path",
              "Plugin bundle.overlays.integrations must be a non-empty relative JSON file path."
            );
          } else {
            const normalizedIntegrationsPath = normalizePluginRelativePath(integrationsPath);
            if (!normalizedIntegrationsPath || path.extname(normalizedIntegrationsPath).toLowerCase() !== ".json") {
              addIssue(
                issues,
                "invalid_bundle_overlay_path",
                `Plugin bundle.overlays.integrations must point to a plugin-relative JSON file. Received '${integrationsPath}'.`
              );
            } else {
              normalizedOverlays.integrations = normalizedIntegrationsPath;
            }
          }
        }
        if (normalizedOverlays.launchers || normalizedOverlays.integrations) {
          bundle.overlays = normalizedOverlays;
        }
      } else if (input.bundle.overlays !== undefined) {
        addIssue(
          issues,
          "invalid_bundle_overlays",
          "Plugin bundle.overlays must be an object when provided."
        );
      }
      if (!bundle.extensions && !bundle.skills && !bundle.skillsets && !bundle.overlays) {
        bundle = undefined;
      }
    }
  }

  if (kind === "bundle") {
    if (!hasBundleContributions(bundle)) {
      addIssue(
        issues,
        "missing_bundle_contributions",
        "Bundle plugins must declare at least one extension, skill, or skillset contribution."
      );
    }
  } else if ("bundle" in input) {
    addIssue(
      issues,
      "bundle_contributions_not_supported",
      `Plugin kind '${String(kind)}' cannot declare bundle contributions.`
    );
  }

  if (
    issues.some(
      (issue) =>
        issue.severity === "error" &&
        [
          "invalid_manifest",
          "invalid_plugin_id",
          "invalid_plugin_name",
          "invalid_plugin_version",
          "unsupported_api_version",
          "invalid_plugin_kind",
          "invalid_requested_capabilities",
          "invalid_capability_array",
          "invalid_capability_value",
          "invalid_views_container",
          "invalid_commands_container",
          "invalid_settings_schema",
          "invalid_settings_fields",
          "invalid_bundle_contributions",
          "invalid_bundle_contribution_array",
          "invalid_bundle_contribution_value",
          "invalid_bundle_contribution_path",
          "invalid_bundle_overlays",
          "invalid_bundle_overlay_path",
        ].includes(issue.code)
    )
  ) {
    return { manifest: null, issues };
  }

  const manifest: PluginManifest = {
    id: String(input.id).trim(),
    name: String(input.name).trim(),
    version: String(input.version).trim(),
    apiVersion: 1,
    kind: kind as PluginKind,
    requestedCapabilities: {
      required: required.filter((capability): capability is PluginCapability =>
        isPluginCapability(capability)
      ),
      optional: optional.filter((capability): capability is PluginCapability =>
        isPluginCapability(capability)
      ),
    },
  };

  if (typeof input.description === "string") {
    manifest.description = input.description;
  }
  if (views.length > 0) {
    manifest.views = views;
  }
  if (commands.length > 0) {
    manifest.commands = commands;
  }
  if (settings) {
    manifest.settings = settings;
  }
  if (bundle) {
    manifest.bundle = bundle;
  }

  return { manifest, issues };
}

export async function validatePluginEntries(
  manifest: PluginManifest,
  pluginRoot: string,
  issues: PluginIssue[]
): Promise<void> {
  for (const view of manifest.views ?? []) {
    const entryPath = resolvePluginRelativePath(pluginRoot, view.entry);
    if (!entryPath || !(await pathExistsAndIsFile(entryPath))) {
      addIssue(
        issues,
        "missing_view_entry",
        `Plugin view entry '${view.entry}' was not found for view '${view.id}'.`
      );
      continue;
    }

    if (manifest.kind === "ui-sandbox" && !isHtmlPluginEntry(view.entry)) {
      addIssue(
        issues,
        "unsupported_view_entry",
        `Phase-1 ui-sandbox views must use an HTML entry file. View '${view.id}' uses '${view.entry}'.`
      );
    }
  }

  if (manifest.settings?.entry) {
    const settingsEntry = resolvePluginRelativePath(pluginRoot, manifest.settings.entry);
    if (!settingsEntry || !(await pathExistsAndIsFile(settingsEntry))) {
      addIssue(
        issues,
        "missing_settings_entry",
        `Plugin settings entry '${manifest.settings.entry}' was not found.`
      );
    }
  }

  for (const contributionKind of ["extensions", "skills", "skillsets"] as const) {
    for (const relativePath of manifest.bundle?.[contributionKind] ?? []) {
      const absolutePath = resolvePluginRelativePath(pluginRoot, relativePath);
      if (!absolutePath || !(await pathExistsAndIsFile(absolutePath))) {
        addIssue(
          issues,
          "missing_bundle_contribution",
          `Plugin bundle.${contributionKind} entry '${relativePath}' was not found.`
        );
        continue;
      }

      if (!getBundleContributionExtensionKind(contributionKind, relativePath)) {
        addIssue(
          issues,
          "invalid_bundle_contribution_type",
          `Plugin bundle.${contributionKind} entry '${relativePath}' uses an unsupported file type.`
        );
      }
    }
  }

  if (manifest.bundle?.overlays?.launchers) {
    const launchersOverlayPath = resolvePluginRelativePath(
      pluginRoot,
      manifest.bundle.overlays.launchers
    );
    if (!launchersOverlayPath || !(await pathExistsAndIsFile(launchersOverlayPath))) {
      addIssue(
        issues,
        "missing_bundle_overlay",
        `Plugin bundle.overlays.launchers entry '${manifest.bundle.overlays.launchers}' was not found.`
      );
    }
  }
  if (manifest.bundle?.overlays?.integrations) {
    const integrationsOverlayPath = resolvePluginRelativePath(
      pluginRoot,
      manifest.bundle.overlays.integrations
    );
    if (!integrationsOverlayPath || !(await pathExistsAndIsFile(integrationsOverlayPath))) {
      addIssue(
        issues,
        "missing_bundle_overlay",
        `Plugin bundle.overlays.integrations entry '${manifest.bundle.overlays.integrations}' was not found.`
      );
    }
  }
}

export async function readValidatedPluginDirectory(
  pluginRoot: string
): Promise<ValidatedPluginDirectory> {
  const manifestPath = path.join(pluginRoot, PLUGIN_MANIFEST_FILENAME);
  if (!(await fileExists(manifestPath))) {
    return {
      manifest: null,
      manifestHash: null,
      issues: [
        {
          code: "manifest_read_failed",
          severity: "error",
          message: "Plugin manifest file 'plugin.json' was not found.",
        },
      ],
    };
  }

  try {
    const rawManifest = JSON.parse(await readFileContent(manifestPath));
    const validated = validatePluginManifest(rawManifest, pluginRoot);
    if (validated.manifest) {
      await validatePluginEntries(validated.manifest, pluginRoot, validated.issues);
    }
    return {
      manifest: validated.manifest,
      manifestHash: validated.manifest ? hashPluginManifest(validated.manifest) : null,
      issues: validated.issues,
    };
  } catch (error) {
    return {
      manifest: null,
      manifestHash: null,
      issues: [
        {
          code: "manifest_read_failed",
          severity: "error",
          message:
            error instanceof Error
              ? `Failed to read plugin manifest: ${error.message}`
              : "Failed to read plugin manifest.",
        },
      ],
    };
  }
}
