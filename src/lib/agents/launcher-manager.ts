import fs from "fs/promises";
import path from "path";
import {
  getYantraRoots,
  ensureRuntimeRootExists,
  resolveRuntimePath,
  resolveVaultPath,
} from "@/lib/config/yantra-roots";
import type { AgentPersona } from "./persona-manager";
import type { JobConfig } from "@/types/jobs";
import type {
  AgentLaunchConfig,
  CliLauncherDefinition,
  JobExecutionConfig,
  LauncherRegistryConfig,
  ResolvedLaunchSpec,
} from "@/types/launchers";

const DEFAULT_LAUNCHER_ID = "claude-code";
const PI_AGENT_STACK_LAUNCHER_ID = "pi-agent-stack";

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
        command: process.env.YANTRA_DEFAULT_CLI_COMMAND?.trim() || "claude",
        args: ["--dangerously-skip-permissions"],
        cwdBase: "vault",
        promptDelivery: {
          method: "pty_write",
          when: "ready",
          readyPattern: "(?:^|\\n)[❯>]\\s*$",
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
        command:
          process.env.YANTRA_PI_AGENT_STACK_COMMAND?.trim() ||
          "{{vaultRoot}}/00-09 System/05 - Tooling/Tools/pi-agent-stack.sh",
        args: ["{{vars.stackFile}}"],
        cwdBase: "vault",
        requiredVars: ["stackFile"],
        promptDelivery: {
          method: "pty_write",
          when: "ready",
          readyPattern: "(?:^|\\n)[❯>]\\s*$",
          submit: true,
        },
      },
    },
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
    return {
      ...defaultLauncherRegistry(),
      ...parsed,
      launchers: {
        ...defaultLauncherRegistry().launchers,
        ...(parsed.launchers || {}),
      },
    };
  } catch {
    return defaultLauncherRegistry();
  }
}

export async function saveLauncherRegistry(
  config: LauncherRegistryConfig
): Promise<void> {
  const configPath = getLaunchersConfigPath();
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
}

function resolveBaseCwd(
  launcher: CliLauncherDefinition,
  cwdOverride: string | undefined
): string {
  const base = launcher.cwdBase || "vault";
  const rawCwd = cwdOverride || ".";

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
): string {
  if (job?.execution?.launcherId) return job.execution.launcherId;
  if (job?.execution?.inheritAgent === false && job.provider) return job.provider;
  if (persona?.launcher?.launcherId) return persona.launcher.launcherId;
  if (job?.provider) return job.provider;
  return registry.defaultLauncherId || DEFAULT_LAUNCHER_ID;
}

export async function resolveLaunchSpec(input: {
  prompt: string;
  persona?: AgentPersona | null;
  job?: JobConfig;
  cwd?: string;
}): Promise<ResolvedLaunchSpec> {
  const registry = await loadLauncherRegistry();
  const launcherId = resolveLauncherId(registry, input.persona, input.job);
  const launcher = registry.launchers[launcherId];

  if (!launcher) {
    throw new Error(`Launcher not found: ${launcherId}`);
  }

  const agentLaunch = input.persona?.launcher;
  const execution = input.job?.execution;
  const shouldInheritAgent = execution?.inheritAgent !== false;
  const mergedVars = mergeVars(shouldInheritAgent ? agentLaunch : undefined, execution);
  const cwdOverride =
    execution?.cwd ||
    input.cwd ||
    (shouldInheritAgent ? agentLaunch?.cwd : undefined) ||
    input.persona?.workdir;

  const resolvedCwd = resolveBaseCwd(launcher, cwdOverride);
  const { vaultRoot, runtimeRoot } = getYantraRoots();
  const templateContext = {
    vaultRoot,
    runtimeRoot,
    cwd: resolvedCwd,
    agentSlug: input.persona?.slug || input.job?.agentSlug,
    jobId: input.job?.id,
    prompt: input.prompt,
    vars: mergedVars,
  };

  const promptDelivery = launcher.promptDelivery || {
    method: "pty_write",
    when: "ready",
    readyPattern: "(?:^|\\n)[❯>]\\s*$",
    submit: true,
  };

  for (const requiredVar of launcher.requiredVars || []) {
    if (!mergedVars[requiredVar]?.trim()) {
      throw new Error(
        `Launcher "${launcherId}" requires vars.${requiredVar} to be set`
      );
    }
  }

  const args = [
    ...launcher.args.map((arg) => expandTemplate(arg, templateContext)),
    ...(promptDelivery.method === "argv"
      ? promptDelivery.promptArgs.map((arg) =>
          expandTemplate(arg, templateContext)
        )
      : []),
  ];

  return {
    command: expandTemplate(launcher.command, templateContext),
    args,
    cwd: resolvedCwd,
    env: mergeEnv(
      launcher,
      shouldInheritAgent ? agentLaunch : undefined,
      execution,
      resolvedCwd
    ),
    promptDelivery,
    transport: launcher.transport || registry.defaultTransport || "direct",
  };
}
