import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import {
  getYantraRoots,
  ensureRuntimeRootExists,
  resolveRuntimePath,
  resolveVaultPath,
} from "@/lib/config/yantra-roots";
import { listEnabledLauncherOverlayPlugins } from "@/lib/plugins/plugin-manager";
import { resolvePluginRelativePath } from "@/lib/plugins/plugin-manifest";
import type { JobConfig } from "@/types/jobs";
import type {
  AgentLaunchConfig,
  CliLauncherDefinition,
  CliLauncherPromptDelivery,
  JobExecutionConfig,
  LauncherCatalogEntry,
  LauncherOverlayIssue,
  LauncherRegistryConfig,
  LauncherRegistryReadResponse,
  ResolvedLaunchPreview,
  ResolvedLaunchSpec,
} from "@/types/launchers";
import type { AgentPersona } from "@/types/personas";

const DEFAULT_LAUNCHER_ID = "claude-code";
const PI_AGENT_STACK_LAUNCHER_ID = "pi-agent-stack";
const CODEX_LAUNCHER_ID = "codex";
const PLUGIN_LAUNCHER_ID_PREFIX = "@plugin/";

interface EffectiveLauncherRegistryState {
  baseRegistry: LauncherRegistryConfig;
  effectiveRegistry: LauncherRegistryConfig;
  availableLaunchers: LauncherCatalogEntry[];
  overlayIssues: LauncherOverlayIssue[];
}

export type LaunchSelectionSource =
  | "job.execution.launcherId"
  | "job.provider.override"
  | "persona.launcher.launcherId"
  | "job.provider.fallback"
  | "registry.defaultLauncherId";

export interface LaunchSelectionResult {
  registry: LauncherRegistryConfig;
  launcherId: string;
  launcher: CliLauncherDefinition | null;
  source: LaunchSelectionSource;
  shouldInheritAgent: boolean;
  mergedVars: Record<string, string>;
  agentLaunch?: AgentLaunchConfig;
  execution?: JobExecutionConfig;
}

function isPluginLauncherId(value: string): boolean {
  return value.startsWith(PLUGIN_LAUNCHER_ID_PREFIX);
}

function getPluginLauncherId(pluginId: string, localLauncherId: string): string {
  return `${PLUGIN_LAUNCHER_ID_PREFIX}${pluginId}/${localLauncherId}`;
}

function quoteShellArg(value: string): string {
  if (value.length === 0) return "''";
  if (/^[A-Za-z0-9_./:=@%-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function formatCommandLine(command: string, args: string[]): string {
  return [command, ...args].map(quoteShellArg).join(" ");
}

function parseCommandLine(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let tokenStarted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (inSingle) {
      if (char === "'") {
        inSingle = false;
      } else {
        current += char;
      }
      continue;
    }

    if (inDouble) {
      if (char === "\"") {
        inDouble = false;
      } else if (char === "\\") {
        index += 1;
        if (index >= input.length) {
          throw new Error("Direct CLI command ends with an unfinished escape.");
        }
        current += input[index];
      } else {
        current += char;
      }
      tokenStarted = true;
      continue;
    }

    if (/\s/.test(char)) {
      if (tokenStarted) {
        tokens.push(current);
        current = "";
        tokenStarted = false;
      }
      continue;
    }

    if (char === "'") {
      inSingle = true;
      tokenStarted = true;
      continue;
    }

    if (char === "\"") {
      inDouble = true;
      tokenStarted = true;
      continue;
    }

    if (char === "\\") {
      index += 1;
      if (index >= input.length) {
        throw new Error("Direct CLI command ends with an unfinished escape.");
      }
      current += input[index];
      tokenStarted = true;
      continue;
    }

    current += char;
    tokenStarted = true;
  }

  if (inSingle || inDouble) {
    throw new Error("Direct CLI command has an unterminated quote.");
  }

  if (tokenStarted) {
    tokens.push(current);
  }

  return tokens;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isTransport(value: unknown): value is "direct" | "tmux" {
  return value === "direct" || value === "tmux";
}

function isPromptDelivery(value: unknown): value is CliLauncherPromptDelivery {
  if (!isPlainObject(value) || typeof value.method !== "string") return false;
  if (value.method === "none") return true;
  if (
    value.method === "argv" &&
    Array.isArray(value.promptArgs) &&
    value.promptArgs.every((item) => typeof item === "string")
  ) {
    return true;
  }
  if (
    value.method === "pty_write" &&
    (value.when === "immediate" || value.when === "ready")
  ) {
    return true;
  }
  return false;
}

function toStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    return null;
  }
  return value;
}

function toStringRecord(value: unknown): Record<string, string> | null {
  if (!isPlainObject(value)) return null;
  const entries = Object.entries(value);
  if (!entries.every(([, item]) => typeof item === "string")) {
    return null;
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function defaultLauncherRegistry(): LauncherRegistryConfig {
  const defaultTransport =
    process.env.YANTRA_DEFAULT_LAUNCHER_TRANSPORT?.trim() === "direct"
      ? "direct"
      : "tmux";

  return {
    version: 1,
    defaultLauncherId:
      process.env.YANTRA_DEFAULT_LAUNCHER_ID?.trim() || DEFAULT_LAUNCHER_ID,
    defaultTransport,
    launchers: {
      [DEFAULT_LAUNCHER_ID]: {
        id: DEFAULT_LAUNCHER_ID,
        label: "Claude Code",
        description:
          "Launches the Claude CLI and sends prompts into the interactive PTY session.",
        command: process.env.YANTRA_DEFAULT_CLI_COMMAND?.trim() || "claude",
        args: ["--dangerously-skip-permissions"],
        cwdBase: "vault",
        promptDelivery: {
          method: "pty_write",
          when: "ready",
          readyPattern: "(?:^|\\n)[\\u276F>]\\s*$",
          submit: true,
        },
        healthcheck: {
          command: process.env.YANTRA_DEFAULT_CLI_COMMAND?.trim() || "claude",
          args: ["--version"],
        },
      },
      [PI_AGENT_STACK_LAUNCHER_ID]: {
        id: PI_AGENT_STACK_LAUNCHER_ID,
        label: "pi-agent-stack",
        description:
          "Runs the pi stack wrapper script using vars.stackFile to select the agent stack JSON.",
        command:
          process.env.YANTRA_PI_AGENT_STACK_COMMAND?.trim() ||
          "{{vaultRoot}}/00-09 System/05 - Tooling/Tools/pi-agent-stack.sh",
        args: ["{{vars.stackFile}}"],
        cwdBase: "vault",
        requiredVars: ["stackFile"],
        promptDelivery: {
          method: "pty_write",
          when: "ready",
          readyPattern: "(?:^|\\n)[\\u276F>]\\s*$",
          submit: true,
        },
      },
      [CODEX_LAUNCHER_ID]: {
        id: CODEX_LAUNCHER_ID,
        label: "Codex CLI",
        description:
          "Launches Codex CLI directly and injects the initial prompt as an argv argument.",
        command: process.env.YANTRA_CODEX_COMMAND?.trim() || "codex",
        args: ["--dangerously-bypass-approvals-and-sandbox"],
        cwdBase: "vault",
        promptDelivery: {
          method: "argv",
          promptArgs: ["{{prompt}}"],
        },
        healthcheck: {
          command: process.env.YANTRA_CODEX_COMMAND?.trim() || "codex",
          args: ["--version"],
        },
      },
    },
  };
}

export function validateLauncherRegistryConfig(
  input: unknown,
  options?: { allowPluginLauncherIds?: boolean }
): {
  config: LauncherRegistryConfig;
  issues: Array<{ path: string; message: string }>;
} {
  const defaults = defaultLauncherRegistry();
  const issues: Array<{ path: string; message: string }> = [];

  if (!isPlainObject(input)) {
    return {
      config: defaults,
      issues: [{ path: "$", message: "Launcher registry must be a JSON object." }],
    };
  }

  const raw = input as Record<string, unknown>;
  const version = raw.version === undefined ? 1 : raw.version;
  if (version !== 1) {
    issues.push({ path: "version", message: "Only version 1 launcher registries are supported." });
  }

  const requestedDefaultLauncherId =
    typeof raw.defaultLauncherId === "string" && raw.defaultLauncherId.trim()
      ? raw.defaultLauncherId.trim()
      : defaults.defaultLauncherId;
  const defaultLauncherId =
    !options?.allowPluginLauncherIds && isPluginLauncherId(requestedDefaultLauncherId)
      ? defaults.defaultLauncherId
      : requestedDefaultLauncherId;

  if (!(typeof raw.defaultLauncherId === "string" && raw.defaultLauncherId.trim())) {
    issues.push({ path: "defaultLauncherId", message: "defaultLauncherId must be a non-empty string." });
  } else if (!options?.allowPluginLauncherIds && isPluginLauncherId(requestedDefaultLauncherId)) {
    issues.push({
      path: "defaultLauncherId",
      message: "defaultLauncherId cannot reference a plugin-contributed launcher.",
    });
  }

  const defaultTransport =
    raw.defaultTransport === undefined
      ? defaults.defaultTransport
      : isTransport(raw.defaultTransport)
        ? raw.defaultTransport
        : defaults.defaultTransport;

  if (raw.defaultTransport !== undefined && !isTransport(raw.defaultTransport)) {
    issues.push({ path: "defaultTransport", message: "defaultTransport must be \"direct\" or \"tmux\"." });
  }

  const rawLaunchersInput = isPlainObject(raw.launchers) ? raw.launchers : {};
  if (!isPlainObject(raw.launchers)) {
    issues.push({ path: "launchers", message: "launchers must be an object keyed by launcher id." });
  }

  const rawLaunchers: Record<string, unknown> = {};
  for (const [launcherId, launcherValue] of Object.entries(rawLaunchersInput)) {
    if (!options?.allowPluginLauncherIds && isPluginLauncherId(launcherId)) {
      issues.push({
        path: `launchers.${launcherId}`,
        message: "Plugin-contributed launcher ids are read-only and cannot be saved into the owned launcher registry.",
      });
      continue;
    }
    rawLaunchers[launcherId] = launcherValue;
  }

  const launcherIds = new Set<string>([
    ...Object.keys(defaults.launchers),
    ...Object.keys(rawLaunchers),
  ]);
  const launchers: Record<string, CliLauncherDefinition> = {};

  for (const launcherId of launcherIds) {
    const fallback = defaults.launchers[launcherId];
    const rawLauncher = rawLaunchers[launcherId];

    if (rawLauncher !== undefined && !isPlainObject(rawLauncher)) {
      issues.push({
        path: `launchers.${launcherId}`,
        message: "Launcher definitions must be objects.",
      });
      if (fallback) {
        launchers[launcherId] = fallback;
      }
      continue;
    }

    const source = {
      ...(fallback || {}),
      ...((rawLauncher as Record<string, unknown> | undefined) || {}),
    } as Record<string, unknown>;

    const label = typeof source.label === "string" && source.label.trim() ? source.label.trim() : "";
    if (!label) {
      issues.push({
        path: `launchers.${launcherId}.label`,
        message: "label must be a non-empty string.",
      });
    }

    const command =
      typeof source.command === "string" && source.command.trim()
        ? source.command.trim()
        : "";
    if (!command) {
      issues.push({
        path: `launchers.${launcherId}.command`,
        message: "command must be a non-empty string.",
      });
    }

    const args = toStringArray(source.args);
    if (!args) {
      issues.push({
        path: `launchers.${launcherId}.args`,
        message: "args must be an array of strings.",
      });
    }

    const env = source.env === undefined ? undefined : toStringRecord(source.env);
    if (source.env !== undefined && !env) {
      issues.push({
        path: `launchers.${launcherId}.env`,
        message: "env must be an object with string values.",
      });
    }

    const requiredVars =
      source.requiredVars === undefined ? undefined : toStringArray(source.requiredVars);
    if (source.requiredVars !== undefined && !requiredVars) {
      issues.push({
        path: `launchers.${launcherId}.requiredVars`,
        message: "requiredVars must be an array of strings.",
      });
    }

    if (
      source.cwdBase !== undefined &&
      source.cwdBase !== "vault" &&
      source.cwdBase !== "runtime"
    ) {
      issues.push({
        path: `launchers.${launcherId}.cwdBase`,
        message: "cwdBase must be \"vault\" or \"runtime\".",
      });
    }

    if (source.transport !== undefined && !isTransport(source.transport)) {
      issues.push({
        path: `launchers.${launcherId}.transport`,
        message: "transport must be \"direct\" or \"tmux\".",
      });
    }

    if (source.promptDelivery !== undefined && !isPromptDelivery(source.promptDelivery)) {
      issues.push({
        path: `launchers.${launcherId}.promptDelivery`,
        message: "promptDelivery must be a valid launcher prompt delivery object.",
      });
    }

    if (source.healthcheck !== undefined) {
      if (!isPlainObject(source.healthcheck)) {
        issues.push({
          path: `launchers.${launcherId}.healthcheck`,
          message: "healthcheck must be an object when provided.",
        });
      } else {
        const hc = source.healthcheck;
        if (hc.command !== undefined && typeof hc.command !== "string") {
          issues.push({
            path: `launchers.${launcherId}.healthcheck.command`,
            message: "healthcheck.command must be a string.",
          });
        }
        if (hc.args !== undefined && !toStringArray(hc.args)) {
          issues.push({
            path: `launchers.${launcherId}.healthcheck.args`,
            message: "healthcheck.args must be an array of strings.",
          });
        }
      }
    }

    launchers[launcherId] = {
      ...source,
      id:
        typeof source.id === "string" && source.id.trim()
          ? source.id.trim()
          : launcherId,
      label: label || launcherId,
      description:
        typeof source.description === "string" && source.description.trim()
          ? source.description.trim()
          : undefined,
      command: command || fallback?.command || "",
      args: args || fallback?.args || [],
      cwdBase: source.cwdBase === "runtime" ? "runtime" : source.cwdBase === "vault" ? "vault" : fallback?.cwdBase,
      env: env || fallback?.env,
      requiredVars: requiredVars || fallback?.requiredVars,
      promptDelivery: isPromptDelivery(source.promptDelivery)
        ? source.promptDelivery
        : fallback?.promptDelivery,
      transport: isTransport(source.transport) ? source.transport : fallback?.transport,
      healthcheck: isPlainObject(source.healthcheck)
        ? {
            command:
              typeof source.healthcheck.command === "string"
                ? source.healthcheck.command
                : undefined,
            args: toStringArray(source.healthcheck.args) || undefined,
          }
        : fallback?.healthcheck,
    };
  }

  return {
    config: {
      ...(raw as Partial<LauncherRegistryConfig>),
      version: 1,
      defaultLauncherId,
      defaultTransport,
      launchers,
    },
    issues,
  };
}

export function getLaunchersConfigPath(): string {
  ensureRuntimeRootExists();
  const { runtimeConfigRoot } = getYantraRoots();
  return path.join(runtimeConfigRoot, "launchers.json");
}

export async function loadLauncherRegistry(): Promise<LauncherRegistryConfig> {
  try {
    const raw = await fs.readFile(getLaunchersConfigPath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<LauncherRegistryConfig>;
    return validateLauncherRegistryConfig(parsed).config;
  } catch {
    return defaultLauncherRegistry();
  }
}

export async function saveLauncherRegistry(
  config: LauncherRegistryConfig
): Promise<void> {
  const normalized = validateLauncherRegistryConfig(config).config;
  const configPath = getLaunchersConfigPath();
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(normalized, null, 2), "utf-8");
}

function sortLauncherCatalogEntries(
  entries: LauncherCatalogEntry[],
  defaultLauncherId: string
): LauncherCatalogEntry[] {
  return [...entries].sort((left, right) => {
    if (left.id === defaultLauncherId) return -1;
    if (right.id === defaultLauncherId) return 1;
    if (left.source.kind !== right.source.kind) {
      return left.source.kind === "owned" ? -1 : 1;
    }
    return left.label.localeCompare(right.label);
  });
}

function validatePluginLauncherOverlayFile(input: {
  pluginId: string;
  pluginName: string;
  content: unknown;
}): {
  launchers: Record<string, CliLauncherDefinition>;
  catalogEntries: LauncherCatalogEntry[];
  issues: LauncherOverlayIssue[];
} {
  const issues: LauncherOverlayIssue[] = [];
  const pushIssue = (message: string) => {
    issues.push({
      pluginId: input.pluginId,
      pluginName: input.pluginName,
      message,
    });
  };

  if (!isPlainObject(input.content)) {
    pushIssue("Launcher overlay must be a JSON object.");
    return { launchers: {}, catalogEntries: [], issues };
  }

  if (input.content.version !== 1) {
    pushIssue("Launcher overlay version must be 1.");
  }
  if ("defaultLauncherId" in input.content) {
    pushIssue("Launcher overlays cannot declare defaultLauncherId.");
  }
  if ("defaultTransport" in input.content) {
    pushIssue("Launcher overlays cannot declare defaultTransport.");
  }
  if (!isPlainObject(input.content.launchers)) {
    pushIssue("Launcher overlay must define a launchers object.");
    return { launchers: {}, catalogEntries: [], issues };
  }

  const overlayLaunchers = input.content.launchers as Record<string, unknown>;
  const normalizedLaunchers: Record<string, unknown> = {};
  const localLauncherIds: Array<{ localId: string; effectiveId: string }> = [];

  for (const [localId, launcherValue] of Object.entries(overlayLaunchers)) {
    if (!localId.trim() || localId.includes("/") || localId === "." || localId === "..") {
      pushIssue(`Launcher overlay id '${localId}' is invalid.`);
      continue;
    }
    const effectiveId = getPluginLauncherId(input.pluginId, localId.trim());
    normalizedLaunchers[effectiveId] = {
      ...(isPlainObject(launcherValue) ? launcherValue : {}),
      id: effectiveId,
    };
    localLauncherIds.push({ localId: localId.trim(), effectiveId });
  }

  const validated = validateLauncherRegistryConfig(
    {
      version: 1,
      defaultLauncherId: DEFAULT_LAUNCHER_ID,
      defaultTransport: "direct",
      launchers: normalizedLaunchers,
    },
    { allowPluginLauncherIds: true }
  );

  for (const issue of validated.issues) {
    if (issue.path === "defaultLauncherId" || issue.path === "defaultTransport") {
      continue;
    }
    if (issue.path.startsWith("launchers.claude-code") || issue.path.startsWith("launchers.pi-agent-stack") || issue.path.startsWith("launchers.codex")) {
      continue;
    }
    pushIssue(`${issue.path}: ${issue.message}`);
  }

  if (issues.length > 0) {
    return { launchers: {}, catalogEntries: [], issues };
  }

  const launchers = Object.fromEntries(
    localLauncherIds
      .map(({ effectiveId }) => {
        const launcher = validated.config.launchers[effectiveId];
        return launcher ? [effectiveId, launcher] : null;
      })
      .filter((entry): entry is [string, CliLauncherDefinition] => Boolean(entry))
  );

  const catalogEntries: LauncherCatalogEntry[] = [];
  for (const { localId, effectiveId } of localLauncherIds) {
    const launcher = launchers[effectiveId];
    if (!launcher) continue;
    catalogEntries.push({
      id: effectiveId,
      label: launcher.label,
      description: launcher.description,
      readOnly: true,
      source: {
        kind: "plugin",
        pluginId: input.pluginId,
        pluginName: input.pluginName,
        localId,
      },
    });
  }

  return { launchers, catalogEntries, issues };
}

async function buildEffectiveLauncherRegistryState(
  baseRegistry?: LauncherRegistryConfig
): Promise<EffectiveLauncherRegistryState> {
  const resolvedBaseRegistry = baseRegistry ?? (await loadLauncherRegistry());
  const effectiveLaunchers: Record<string, CliLauncherDefinition> = {
    ...resolvedBaseRegistry.launchers,
  };
  const overlayIssues: LauncherOverlayIssue[] = [];
  const availableLaunchers: LauncherCatalogEntry[] = Object.values(
    resolvedBaseRegistry.launchers
  ).map(
    (launcher) => ({
      id: launcher.id,
      label: launcher.label,
      description: launcher.description,
      readOnly: false,
      source: { kind: "owned" },
    })
  );

  const overlayPlugins = await listEnabledLauncherOverlayPlugins();
  for (const plugin of overlayPlugins) {
    const overlayPath = resolvePluginRelativePath(
      plugin.source.pluginPath,
      plugin.manifest.bundle.overlays.launchers
    );
    if (!overlayPath) {
      overlayIssues.push({
        pluginId: plugin.manifest.id,
        pluginName: plugin.manifest.name,
        message: `Launcher overlay path '${plugin.manifest.bundle.overlays.launchers}' is invalid.`,
      });
      continue;
    }

    try {
      const rawOverlay = JSON.parse(await fs.readFile(overlayPath, "utf-8"));
      const validated = validatePluginLauncherOverlayFile({
        pluginId: plugin.manifest.id,
        pluginName: plugin.manifest.name,
        content: rawOverlay,
      });
      overlayIssues.push(...validated.issues);
      Object.assign(effectiveLaunchers, validated.launchers);
      availableLaunchers.push(...validated.catalogEntries);
    } catch (error) {
      overlayIssues.push({
        pluginId: plugin.manifest.id,
        pluginName: plugin.manifest.name,
        message:
          error instanceof Error
            ? `Failed to read launcher overlay: ${error.message}`
            : "Failed to read launcher overlay.",
      });
    }
  }

  return {
    baseRegistry: resolvedBaseRegistry,
    effectiveRegistry: {
      ...resolvedBaseRegistry,
      launchers: effectiveLaunchers,
    },
    availableLaunchers: sortLauncherCatalogEntries(
      availableLaunchers,
      resolvedBaseRegistry.defaultLauncherId
    ),
    overlayIssues,
  };
}

export async function getLauncherRegistryReadResponse(): Promise<LauncherRegistryReadResponse> {
  const state = await buildEffectiveLauncherRegistryState();
  return {
    registry: state.baseRegistry,
    availableLaunchers: state.availableLaunchers,
    overlayIssues: state.overlayIssues,
  };
}

export async function loadEffectiveLauncherRegistry(): Promise<LauncherRegistryConfig> {
  return (await buildEffectiveLauncherRegistryState()).effectiveRegistry;
}

function formatMissingLauncherMessage(launcherId: string): string {
  if (isPluginLauncherId(launcherId)) {
    return `Plugin-contributed launcher not found or unavailable: ${launcherId}`;
  }
  return `Launcher not found: ${launcherId}`;
}

function resolveBaseCwd(
  launcher: CliLauncherDefinition,
  cwdOverride: string | undefined
): string {
  const base = launcher.cwdBase || "vault";
  const rawCwd = cwdOverride || ".";

  if (base === "vault") {
    if (rawCwd === "/data") {
      return resolveVaultPath(".");
    }
    if (rawCwd.startsWith("/data/")) {
      return resolveVaultPath(rawCwd.slice("/data/".length));
    }
  }

  if (path.isAbsolute(rawCwd)) {
    return base === "runtime"
      ? resolveRuntimePath(rawCwd)
      : resolveVaultPath(rawCwd);
  }

  return base === "runtime"
    ? resolveRuntimePath(rawCwd)
    : resolveVaultPath(rawCwd);
}

function expandTemplate(
  value: string,
  context: {
    vaultRoot: string;
    runtimeRoot: string;
    cwd: string;
    agentSlug?: string;
    jobId?: string;
    prompt?: string;
    vars: Record<string, string>;
  }
): string {
  return value.replace(/\{\{([^}]+)\}\}/g, (_match, token: string) => {
    const trimmed = token.trim();
    if (trimmed === "vaultRoot") return context.vaultRoot;
    if (trimmed === "runtimeRoot") return context.runtimeRoot;
    if (trimmed === "cwd") return context.cwd;
    if (trimmed === "agentSlug") return context.agentSlug || "";
    if (trimmed === "jobId") return context.jobId || "";
    if (trimmed === "prompt") return context.prompt || "";
    if (trimmed.startsWith("vars.")) {
      return context.vars[trimmed.slice("vars.".length)] || "";
    }
    return "";
  });
}

function mergeVars(
  agentLaunch: AgentLaunchConfig | undefined,
  execution: JobExecutionConfig | undefined
): Record<string, string> {
  return {
    ...(agentLaunch?.vars || {}),
    ...(execution?.vars || {}),
  };
}

function mergeEnv(
  launcher: CliLauncherDefinition,
  agentLaunch: AgentLaunchConfig | undefined,
  execution: JobExecutionConfig | undefined,
  resolvedCwd: string
): Record<string, string> {
  const { vaultRoot, runtimeRoot } = getYantraRoots();
  const vars = mergeVars(agentLaunch, execution);
  const baseEnv: Record<string, string> = {
    ...(process.env as Record<string, string>),
    YANTRA_VAULT_ROOT: vaultRoot,
    YANTRA_RUNTIME_ROOT: runtimeRoot,
    YANTRA_WORKDIR: resolvedCwd,
  };

  const applyMap = (input?: Record<string, string>) => {
    for (const [key, value] of Object.entries(input || {})) {
      baseEnv[key] = expandTemplate(value, {
        vaultRoot,
        runtimeRoot,
        cwd: resolvedCwd,
        vars,
      });
    }
  };

  applyMap(launcher.env);
  applyMap(agentLaunch?.env);
  applyMap(execution?.env);

  return baseEnv;
}

function resolveLauncherId(
  registry: LauncherRegistryConfig,
  persona?: AgentPersona | null,
  job?: JobConfig
): { launcherId: string; source: LaunchSelectionSource } {
  if (job?.execution?.launcherId) {
    return {
      launcherId: job.execution.launcherId,
      source: "job.execution.launcherId",
    };
  }
  if (job?.execution?.inheritAgent === false && job.provider) {
    return {
      launcherId: job.provider,
      source: "job.provider.override",
    };
  }
  if (persona?.launcher?.launcherId) {
    return {
      launcherId: persona.launcher.launcherId,
      source: "persona.launcher.launcherId",
    };
  }
  if (job?.provider) {
    return {
      launcherId: job.provider,
      source: "job.provider.fallback",
    };
  }
  return {
    launcherId: registry.defaultLauncherId || DEFAULT_LAUNCHER_ID,
    source: "registry.defaultLauncherId",
  };
}

function createTemplateContext(input: {
  persona?: AgentPersona | null;
  job?: JobConfig;
  prompt?: string;
  cwd: string;
  vars: Record<string, string>;
}) {
  const { vaultRoot, runtimeRoot } = getYantraRoots();
  return {
    vaultRoot,
    runtimeRoot,
    cwd: input.cwd,
    agentSlug: input.persona?.slug || input.job?.agentSlug,
    jobId: input.job?.id,
    prompt: input.prompt,
    vars: input.vars,
  };
}

function resolveBuiltInModelArgs(
  launcherId: string,
  model: string | undefined
): string[] {
  const cleaned = model?.trim();
  if (!cleaned) return [];

  if (
    launcherId === DEFAULT_LAUNCHER_ID ||
    launcherId === PI_AGENT_STACK_LAUNCHER_ID ||
    launcherId === CODEX_LAUNCHER_ID
  ) {
    return ["--model", cleaned];
  }

  return [];
}

function resolveBaseLaunchCommand(input: {
  launcher: CliLauncherDefinition;
  agentLaunch?: AgentLaunchConfig;
  templateContext: ReturnType<typeof createTemplateContext>;
}): {
  command: string;
  args: string[];
  usesDirectCommand: boolean;
} {
  const directCommand = input.agentLaunch?.directCommand?.trim();
  if (directCommand) {
    const missingVars = findMissingVarsInTemplates(
      [directCommand],
      input.templateContext.vars
    );
    if (missingVars.length > 0) {
      throw new Error(
        `Direct CLI command requires vars.${missingVars.join(", vars.")} to be set`
      );
    }
    const expanded = expandTemplate(directCommand, input.templateContext);
    const tokens = parseCommandLine(expanded);
    if (tokens.length === 0) {
      throw new Error("Direct CLI command resolved to an empty command.");
    }
    return {
      command: tokens[0],
      args: tokens.slice(1),
      usesDirectCommand: true,
    };
  }

  return {
    command: expandTemplate(input.launcher.command, input.templateContext),
    args: [
      ...input.launcher.args.map((arg) => expandTemplate(arg, input.templateContext)),
      ...resolveBuiltInModelArgs(input.launcher.id, input.agentLaunch?.model),
    ],
    usesDirectCommand: false,
  };
}

function findMissingVarsInTemplates(
  values: string[],
  vars: Record<string, string>
): string[] {
  const missing = new Set<string>();
  for (const value of values) {
    for (const match of value.matchAll(/\{\{\s*vars\.([^}\s]+)\s*\}\}/g)) {
      const key = match[1];
      if (!vars[key]?.trim()) {
        missing.add(key);
      }
    }
  }
  return Array.from(missing);
}

async function fileExists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

function resolveCandidateFilePath(command: string, cwd: string): string | null {
  if (!command.includes(path.sep) && !command.startsWith(".")) {
    return null;
  }
  return path.isAbsolute(command) ? command : path.resolve(cwd, command);
}

async function runHealthcheckProcess(input: {
  command: string;
  args: string[];
  cwd: string;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Healthcheck timed out after 3500ms for ${input.command}`));
    }, 3500);

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `Exited with status ${code ?? "unknown"}`));
    });
  });
}

export async function getLauncherHealth(input: {
  launcher: CliLauncherDefinition;
  vars?: Record<string, string>;
}): Promise<{
  status: "healthy" | "configured" | "unverified" | "error";
  message: string;
}> {
  const vars = input.vars || {};
  const resolvedCwd = resolveBaseCwd(input.launcher, undefined);
  const templateContext = createTemplateContext({
    cwd: resolvedCwd,
    vars,
  });

  const healthcheckCommand =
    input.launcher.healthcheck?.command || input.launcher.command;
  const healthcheckArgs = input.launcher.healthcheck?.args || [];
  const missingVars = findMissingVarsInTemplates(
    [healthcheckCommand, ...healthcheckArgs],
    vars
  );

  if (input.launcher.healthcheck) {
    if (missingVars.length > 0) {
      return {
        status: "unverified",
        message: `Healthcheck needs vars.${missingVars.join(", vars.")}.`,
      };
    }

    try {
      await runHealthcheckProcess({
        command: expandTemplate(healthcheckCommand, templateContext),
        args: healthcheckArgs.map((arg) => expandTemplate(arg, templateContext)),
        cwd: resolvedCwd,
      });
      return {
        status: "healthy",
        message: "Healthcheck passed.",
      };
    } catch (error) {
      return {
        status: "error",
        message:
          error instanceof Error ? error.message : "Healthcheck failed.",
      };
    }
  }

  if (missingVars.length > 0) {
    return {
      status: "unverified",
      message: `Launcher command needs vars.${missingVars.join(", vars.")}.`,
    };
  }

  const expandedCommand = expandTemplate(input.launcher.command, templateContext);
  const commandPath = resolveCandidateFilePath(expandedCommand, resolvedCwd);
  if (commandPath && (await fileExists(commandPath))) {
    return {
      status: "configured",
      message: "Command path resolves to an existing file.",
    };
  }

  return {
    status: "unverified",
    message: "No explicit healthcheck is configured for this launcher.",
  };
}

export async function resolveLaunchSelection(input: {
  persona?: AgentPersona | null;
  job?: JobConfig;
  registry?: LauncherRegistryConfig;
}): Promise<LaunchSelectionResult> {
  const registry = input.registry || (await loadEffectiveLauncherRegistry());
  const { launcherId, source } = resolveLauncherId(registry, input.persona, input.job);
  const launcher = registry.launchers[launcherId] || null;
  const agentLaunch = input.persona?.launcher;
  const execution = input.job?.execution;
  const shouldInheritAgent = execution?.inheritAgent !== false;
  const mergedVars = mergeVars(shouldInheritAgent ? agentLaunch : undefined, execution);

  return {
    registry,
    launcherId,
    launcher,
    source,
    shouldInheritAgent,
    mergedVars,
    agentLaunch,
    execution,
  };
}

export async function resolveLaunchSpec(input: {
  prompt: string;
  persona?: AgentPersona | null;
  job?: JobConfig;
  cwd?: string;
}): Promise<ResolvedLaunchSpec> {
  const selection = await resolveLaunchSelection({
    persona: input.persona,
    job: input.job,
  });

  if (!selection.launcher) {
    throw new Error(formatMissingLauncherMessage(selection.launcherId));
  }

  const agentLaunch = selection.shouldInheritAgent
    ? selection.agentLaunch
    : undefined;
  const execution = selection.execution;
  const cwdOverride =
    execution?.cwd ||
    input.cwd ||
    agentLaunch?.cwd ||
    input.persona?.workdir;

  const resolvedCwd = resolveBaseCwd(selection.launcher, cwdOverride);
  const templateContext = createTemplateContext({
    persona: input.persona,
    job: input.job,
    prompt: input.prompt,
    cwd: resolvedCwd,
    vars: selection.mergedVars,
  });

  const promptDelivery = selection.launcher.promptDelivery || {
    method: "pty_write" as const,
    when: "ready" as const,
    readyPattern: "(?:^|\\n)[\\u276F>]\\s*$",
    submit: true,
  };

  for (const requiredVar of selection.launcher.requiredVars || []) {
    if (!selection.mergedVars[requiredVar]?.trim()) {
      throw new Error(
        `Launcher \"${selection.launcherId}\" requires vars.${requiredVar} to be set`
      );
    }
  }

  const baseCommand = resolveBaseLaunchCommand({
    launcher: selection.launcher,
    agentLaunch,
    templateContext,
  });

  const args = [
    ...baseCommand.args,
    ...(promptDelivery.method === "argv"
      ? promptDelivery.promptArgs.map((arg) => expandTemplate(arg, templateContext))
      : []),
  ];

  return {
    command: baseCommand.command,
    args,
    cwd: resolvedCwd,
    env: mergeEnv(selection.launcher, agentLaunch, execution, resolvedCwd),
    promptDelivery,
    transport:
      selection.launcher.transport || selection.registry.defaultTransport || "direct",
  };
}

export async function resolveLaunchPreview(input: {
  persona?: AgentPersona | null;
  job?: JobConfig;
  cwd?: string;
}): Promise<ResolvedLaunchPreview> {
  const selection = await resolveLaunchSelection({
    persona: input.persona,
    job: input.job,
  });

  if (!selection.launcher) {
    throw new Error(formatMissingLauncherMessage(selection.launcherId));
  }

  const agentLaunch = selection.shouldInheritAgent
    ? selection.agentLaunch
    : undefined;
  const execution = selection.execution;
  const cwdOverride =
    execution?.cwd ||
    input.cwd ||
    agentLaunch?.cwd ||
    input.persona?.workdir;

  const resolvedCwd = resolveBaseCwd(selection.launcher, cwdOverride);
  const templateContext = createTemplateContext({
    persona: input.persona,
    job: input.job,
    cwd: resolvedCwd,
    vars: selection.mergedVars,
  });
  const promptPreviewContext = createTemplateContext({
    persona: input.persona,
    job: input.job,
    cwd: resolvedCwd,
    prompt: "<prompt>",
    vars: selection.mergedVars,
  });

  const baseCommand = resolveBaseLaunchCommand({
    launcher: selection.launcher,
    agentLaunch,
    templateContext,
  });
  const promptDelivery = selection.launcher.promptDelivery;
  const promptMethod = promptDelivery?.method || "pty_write";
  const previewArgs = [
    ...baseCommand.args,
    ...(promptMethod === "argv" && promptDelivery?.method === "argv"
      ? promptDelivery.promptArgs.map((arg) =>
          expandTemplate(arg, promptPreviewContext)
        ) || []
      : []),
  ];

  return {
    launcherId: selection.launcherId,
    source: selection.source,
    command: baseCommand.command,
    args: previewArgs,
    commandLine: formatCommandLine(baseCommand.command, previewArgs),
    cwd: resolvedCwd,
    transport:
      selection.launcher.transport || selection.registry.defaultTransport || "direct",
    promptMethod,
    usesDirectCommand: baseCommand.usesDirectCommand,
  };
}
