import {
  getLaunchersConfigPath,
  getLauncherHealth,
  loadEffectiveLauncherRegistry,
  resolveLaunchSelection,
} from "@/lib/agents/launcher-manager";
import { getDaemonHealth } from "@/lib/agents/daemon-client";
import { listPersonas } from "@/lib/agents/persona-manager";
import { readAgentStack } from "@/lib/agents/stack-manager";
import { loadAgentJobsBySlug, loadLegacyJobs } from "@/lib/jobs/job-manager";
import type { RuntimeIssue, RuntimeSettingsSummary } from "@/types/settings";

function makeIssue(issue: RuntimeIssue): RuntimeIssue {
  return issue;
}

export async function buildRuntimeSettingsSummary(): Promise<RuntimeSettingsSummary> {
  const registry = await loadEffectiveLauncherRegistry();
  const registryLaunchers = Object.values(registry.launchers);
  const launcherUsage = new Map(
    registryLaunchers.map((launcher) => [
      launcher.id,
      {
        agentCount: 0,
        defaultedAgentCount: 0,
        jobOverrideCount: 0,
        legacyProviderCount: 0,
        stackBackedAgentCount: 0,
      },
    ])
  );

  const issues: RuntimeIssue[] = [];

  let daemon: RuntimeSettingsSummary["daemon"] = {
    reachable: false,
    error: "Daemon status unavailable",
  };

  try {
    const details = await getDaemonHealth({ timeoutMs: 1500 });
    daemon = {
      reachable: true,
      details: {
        service: details.service,
        ptySessions: details.ptySessions,
        scheduledJobs: details.scheduledJobs,
        scheduledHeartbeats: details.scheduledHeartbeats,
        absurdWorkerReady: details.absurdWorkerReady,
        tmuxAvailable: details.tmuxAvailable,
        restartPlan: details.restartPlan,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Daemon status unavailable";
    daemon = {
      reachable: false,
      error: message,
    };
    issues.push(
      makeIssue({
        code: "daemon_unreachable",
        severity: "warning",
        message,
      })
    );
  }

  const personas = await listPersonas();
  let jobProviderFallbackCount = 0;

  const agents = await Promise.all(
    personas.map(async (persona) => {
      const agentIssues: RuntimeIssue[] = [];
      const jobs = await loadAgentJobsBySlug(persona.slug);
      const selection = await resolveLaunchSelection({ persona, registry });
      const launcher = selection.launcher;

      if (!launcherUsage.has(selection.launcherId)) {
        launcherUsage.set(selection.launcherId, {
          agentCount: 0,
          defaultedAgentCount: 0,
          jobOverrideCount: 0,
          legacyProviderCount: 0,
          stackBackedAgentCount: 0,
        });
      }

      const usage = launcherUsage.get(selection.launcherId);
      if (usage) {
        usage.agentCount += 1;
        if (selection.source === "registry.defaultLauncherId") {
          usage.defaultedAgentCount += 1;
        }
      }

      if (!launcher) {
        agentIssues.push(
          makeIssue({
            code: "launcher_missing",
            severity: "error",
            message: `Launcher \"${selection.launcherId}\" is configured for ${persona.name} but is not defined in the launcher registry.`,
          })
        );
      }

      for (const requiredVar of launcher?.requiredVars || []) {
        if (!selection.mergedVars[requiredVar]?.trim()) {
          agentIssues.push(
            makeIssue({
              code: "required_var_missing",
              severity: "error",
              message: `Launcher \"${selection.launcherId}\" requires vars.${requiredVar} for ${persona.name}.`,
            })
          );
        }
      }

      let stackFilePath: string | null = null;
      let stackFileExists: boolean | null = null;
      const stackRequired =
        selection.launcherId === "pi-agent-stack" ||
        Boolean(launcher?.requiredVars?.includes("stackFile"));

      if (stackRequired) {
        try {
          const stackData = await readAgentStack(persona.slug);
          stackFilePath = stackData.stackPath;
          stackFileExists = stackData.stackPath ? Boolean(stackData.stack) : null;
          if (stackFilePath && usage) {
            usage.stackBackedAgentCount += 1;
          }
          if (stackFilePath && !stackData.stack) {
            agentIssues.push(
              makeIssue({
                code: "stack_file_missing",
                severity: "error",
                message: `Stack file \"${stackFilePath}\" for ${persona.name} is missing or unreadable.`,
              })
            );
          }
        } catch (error) {
          stackFileExists = false;
          agentIssues.push(
            makeIssue({
              code: "stack_file_missing",
              severity: "error",
              message:
                error instanceof Error
                  ? error.message
                  : `Failed to inspect stack file for ${persona.name}.`,
            })
          );
        }
      }

      const effectiveTransport =
        launcher?.transport || registry.defaultTransport || "direct";
      if (
        daemon.reachable &&
        daemon.details?.tmuxAvailable === false &&
        effectiveTransport === "tmux"
      ) {
        agentIssues.push(
          makeIssue({
            code: "tmux_unavailable",
            severity: "warning",
            message: `${persona.name} resolves to tmux transport, but the daemon reports tmux is unavailable and will fall back to direct execution.`,
          })
        );
      }

      let jobOverrideCount = 0;
      let jobLegacyProviderCount = 0;

      for (const job of jobs) {
        const jobSelection = await resolveLaunchSelection({
          persona,
          job,
          registry,
        });

        if (!launcherUsage.has(jobSelection.launcherId)) {
          launcherUsage.set(jobSelection.launcherId, {
            agentCount: 0,
            defaultedAgentCount: 0,
            jobOverrideCount: 0,
            legacyProviderCount: 0,
            stackBackedAgentCount: 0,
          });
        }

        const jobUsage = launcherUsage.get(jobSelection.launcherId);
        if (jobSelection.source === "job.execution.launcherId") {
          jobOverrideCount += 1;
          if (jobUsage) {
            jobUsage.jobOverrideCount += 1;
          }
        }

        if (
          jobSelection.source === "job.provider.override" ||
          jobSelection.source === "job.provider.fallback"
        ) {
          jobLegacyProviderCount += 1;
          jobProviderFallbackCount += 1;
          if (jobUsage) {
            jobUsage.legacyProviderCount += 1;
          }
        }
      }

      return {
        slug: persona.slug,
        name: persona.name,
        active: persona.active,
        heartbeat: persona.heartbeat,
        launcherId: selection.launcherId,
        launcherSource:
          selection.source === "persona.launcher.launcherId"
            ? ("persona.launcher.launcherId" as const)
            : ("registry.defaultLauncherId" as const),
        stackFilePath,
        stackFileExists,
        jobCount: jobs.length,
        jobOverrideCount,
        jobLegacyProviderCount,
        issues: agentIssues,
      };
    })
  );

  const rootJobs = await loadLegacyJobs();

  if (rootJobs.length > 0) {
    issues.push(
      makeIssue({
        code: "legacy_root_jobs_present",
        severity: "warning",
        message: `${rootJobs.length} legacy root-level job${rootJobs.length === 1 ? " is" : "s are"} present under data/.jobs. The daemon scheduler uses agent-scoped jobs under .agents/{slug}/jobs instead.`,
      })
    );
  }

  if (jobProviderFallbackCount > 0) {
    issues.push(
      makeIssue({
        code: "legacy_job_provider_fallback",
        severity: "warning",
        message: `${jobProviderFallbackCount} job${jobProviderFallbackCount === 1 ? " still resolves" : "s still resolve"} a launcher through the legacy provider field. Prefer execution.launcherId or persona.launcher.launcherId.`,
      })
    );
  }

  const launcherSummaries = await Promise.all(
    Array.from(launcherUsage.keys()).map(async (launcherId) => {
      const launcher = registry.launchers[launcherId];
      const usage = launcherUsage.get(launcherId) || {
        agentCount: 0,
        defaultedAgentCount: 0,
        jobOverrideCount: 0,
        legacyProviderCount: 0,
        stackBackedAgentCount: 0,
      };

      return {
        launcherId,
        label: launcher?.label || launcherId,
        description: launcher?.description,
        command: launcher?.command || "Missing launcher",
        args: launcher?.args || [],
        cwdBase: launcher?.cwdBase || "vault",
        transport: launcher?.transport || registry.defaultTransport || "direct",
        promptMethod: launcher?.promptDelivery?.method || "pty_write",
        requiredVars: launcher?.requiredVars || [],
        health: launcher
          ? await getLauncherHealth({ launcher })
          : {
              status: "error" as const,
              message: "Launcher is referenced by agents or jobs but missing from the registry.",
            },
        usage,
      };
    })
  );

  launcherSummaries.sort((left, right) => {
    if (left.launcherId === registry.defaultLauncherId) return -1;
    if (right.launcherId === registry.defaultLauncherId) return 1;
    return left.label.localeCompare(right.label);
  });

  agents.sort((left, right) => left.name.localeCompare(right.name));

  return {
    daemon,
    registry: {
      configPath: getLaunchersConfigPath(),
      defaultLauncherId: registry.defaultLauncherId,
      defaultTransport: registry.defaultTransport || "direct",
      launchers: launcherSummaries,
    },
    agents,
    legacy: {
      rootJobCount: rootJobs.length,
      jobProviderFallbackCount,
    },
    issues,
  };
}
