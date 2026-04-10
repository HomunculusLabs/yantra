"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  CloudDownload,
  FolderTree,
  Layers3,
  Loader2,
  RefreshCw,
  ServerCog,
  TerminalSquare,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { UpdateSummary } from "@/components/system/update-summary";
import { useYantraUpdate } from "@/hooks/use-yantra-update";
import { cn } from "@/lib/utils";
import type { RuntimeIssue, RuntimeSettingsSummary } from "@/types/settings";

function issueClasses(severity: RuntimeIssue["severity"]) {
  switch (severity) {
    case "error":
      return "border-red-500/30 bg-red-500/5 text-red-200";
    case "warning":
      return "border-amber-500/30 bg-amber-500/5 text-amber-100";
    default:
      return "border-blue-500/30 bg-blue-500/5 text-blue-100";
  }
}

export function RuntimeSettingsTab({
  summary,
  loading,
  error,
  rootsRestartRequired,
  daemonStatus,
  canRestartDaemon,
  restartingDaemon,
  restartingDaemonMode,
  onRestartDaemon,
  daemonActionError,
}: {
  summary: RuntimeSettingsSummary | null;
  loading: boolean;
  error?: string | null;
  rootsRestartRequired?: boolean;
  daemonStatus?: { reachable: boolean; error?: string | null } | null;
  canRestartDaemon?: boolean;
  restartingDaemon?: boolean;
  restartingDaemonMode?: "soft" | "force" | null;
  onRestartDaemon?: (mode: "soft" | "force") => void | Promise<void>;
  daemonActionError?: string | null;
}) {
  const {
    update,
    loading: updateLoading,
    refreshing: updateRefreshing,
    backupPending,
    backupPath,
    actionError,
    refresh,
    createBackup,
    openDataDir,
  } = useYantraUpdate();

  if (loading) {
    return <p className="text-[13px] text-muted-foreground">Loading runtime summary...</p>;
  }

  if (error) {
    return <p className="text-[13px] text-red-400">{error}</p>;
  }

  if (!summary) {
    return <p className="text-[13px] text-muted-foreground">No runtime summary available.</p>;
  }

  const daemonReachable = summary.daemon.reachable;
  const daemonError = summary.daemon.error;
  const daemonRestarting = Boolean(summary.daemon.details?.shuttingDown);
  const daemonAcceptingSessions = summary.daemon.details?.acceptingSessions !== false;
  const restartPlan = summary.daemon.details?.restartPlan;
  const visibleIssues = summary.issues.filter(
    (issue) => !(daemonReachable && issue.code === "daemon_unreachable")
  );

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <Layers3 className="mt-0.5 h-4 w-4 text-primary" />
          <div className="space-y-2 text-[12px] text-muted-foreground">
            <div>
              <h3 className="text-[14px] font-semibold text-foreground">How Yantra runtime works</h3>
              <p className="mt-1">
                Agents and heartbeats resolve their launcher from <code>persona.launcher.launcherId</code>, then fall back to the registry default. Jobs can override that with <code>execution.launcherId</code>. The old <code>provider</code> field is only a legacy fallback for jobs.
              </p>
            </div>
            <p>
              <code>pi-agent-stack</code> is a launcher, not a provider list. It runs the configured stack file from <code>vars.stackFile</code>, and the daemon executes the final resolved launch spec over PTY or tmux.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                <ServerCog className="h-3.5 w-3.5" />
                Daemon
              </div>
              <div className="mt-2 flex items-center gap-2 text-[14px] font-semibold text-foreground">
                {daemonReachable ? (
                  daemonRestarting || !daemonAcceptingSessions ? (
                    <Clock3 className="h-4 w-4 text-amber-400" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  )
                ) : (
                  <XCircle className="h-4 w-4 text-red-400" />
                )}
                {daemonReachable
                  ? daemonRestarting || !daemonAcceptingSessions
                    ? "Restarting"
                    : "Reachable"
                  : "Unavailable"}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {daemonReachable
                  ? daemonRestarting || !daemonAcceptingSessions
                    ? "Daemon is reachable but not accepting new sessions right now. Wait for restart to finish."
                    : `${summary.daemon.details?.ptySessions ?? 0} live sessions · ${summary.daemon.details?.scheduledJobs ?? 0} scheduled jobs`
                  : daemonError || "Runtime commands may still be configured even if the daemon is offline."}
              </p>
              {daemonStatus && daemonStatus.reachable !== daemonReachable ? (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Browser probe: {daemonStatus.reachable ? "reachable" : daemonStatus.error || "unreachable"}
                </p>
              ) : null}
            </div>
            {canRestartDaemon && onRestartDaemon ? (
              <div className="flex flex-col gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={() => void onRestartDaemon("soft")}
                  disabled={restartingDaemon || !restartPlan?.softSafe}
                >
                  {restartingDaemon && restartingDaemonMode === "soft" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  {restartingDaemon && restartingDaemonMode === "soft"
                    ? "Restarting"
                    : "Safe restart"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={() => void onRestartDaemon("force")}
                  disabled={restartingDaemon}
                >
                  {restartingDaemon && restartingDaemonMode === "force" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <AlertTriangle className="h-3.5 w-3.5" />
                  )}
                  {restartingDaemon && restartingDaemonMode === "force"
                    ? "Restarting"
                    : "Force restart"}
                </Button>
              </div>
            ) : null}
          </div>
          {restartPlan ? (
            <div className="mt-3 space-y-2 text-[11px] text-muted-foreground">
              <p>
                Safe restart {restartPlan.softSafe ? "preserves" : "cannot preserve"} active work. {restartPlan.preservableTmuxSessionCount} tmux session{restartPlan.preservableTmuxSessionCount === 1 ? "" : "s"} can survive; {restartPlan.directSessionCount} direct session{restartPlan.directSessionCount === 1 ? "" : "s"} would be interrupted.
              </p>
              <p>
                Absurd workers restart with the daemon. Queued job recovery relies on Absurd re-claim rather than preserving worker memory.
              </p>
            </div>
          ) : null}
          {daemonActionError ? (
            <p className="mt-2 text-[11px] text-red-300">{daemonActionError}</p>
          ) : null}
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
            <TerminalSquare className="h-3.5 w-3.5" />
            Default launcher
          </div>
          <div className="mt-2 text-[14px] font-semibold text-foreground">
            {summary.registry.defaultLauncherId}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Default transport: {summary.registry.defaultTransport}
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
            <Clock3 className="h-3.5 w-3.5" />
            Runtime totals
          </div>
          <div className="mt-2 text-[14px] font-semibold text-foreground">
            {summary.agents.length} agents · {summary.registry.launchers.length} launchers
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {summary.legacy.jobProviderFallbackCount} legacy job fallback{summary.legacy.jobProviderFallbackCount === 1 ? "" : "s"}
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
            <FolderTree className="h-3.5 w-3.5" />
            Registry file
          </div>
          <div className="mt-2 break-all text-[12px] font-medium text-foreground">
            {summary.registry.configPath}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Advanced launcher definitions live here.
          </p>
        </div>
      </div>

      {update ? (
        <div className="space-y-3">
          <div>
            <h3 className="flex items-center gap-2 text-[14px] font-semibold text-foreground">
              <CloudDownload className="h-4 w-4 text-primary" />
              Release + backup flow
            </h3>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Upstream-style update status, release notes, and backup helpers adapted for Yantra&apos;s current desktop/runtime setup.
            </p>
          </div>
          <UpdateSummary
            update={update}
            loading={updateLoading}
            refreshing={updateRefreshing}
            backupPending={backupPending}
            backupPath={backupPath}
            actionError={actionError}
            onRefresh={refresh}
            onCreateBackup={() => {
              void createBackup();
            }}
            onOpenDataDir={openDataDir}
          />
        </div>
      ) : null}

      {(rootsRestartRequired || visibleIssues.length > 0) && (
        <div className="space-y-2">
          {rootsRestartRequired ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-[12px] text-amber-100">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4" />
                <div>
                  <p className="font-medium text-foreground">Restart required for root changes</p>
                  <p className="mt-1 text-muted-foreground">
                    The runtime summary still reflects the currently active roots until the app server and daemon restart.
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {visibleIssues.map((issue, index) => (
            <div
              key={`${issue.code}-${index}`}
              className={cn("rounded-xl border p-3 text-[12px]", issueClasses(issue.severity))}
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4" />
                <div>
                  <p className="font-medium text-foreground">{issue.code.replaceAll("_", " ")}</p>
                  <p className="mt-1 text-muted-foreground">{issue.message}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3">
        <div>
          <h3 className="text-[14px] font-semibold text-foreground">Launchers in use</h3>
          <p className="mt-1 text-[12px] text-muted-foreground">
            This replaces the old provider cards. These are the actual launch definitions the daemon resolves at runtime.
          </p>
        </div>
        <div className="grid gap-3 xl:grid-cols-2">
          {summary.registry.launchers.map((launcher) => (
            <div key={launcher.launcherId} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-[13px] font-semibold text-foreground">{launcher.label}</h4>
                    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                      {launcher.launcherId}
                    </span>
                    {launcher.launcherId === summary.registry.defaultLauncherId ? (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                        Default
                      </span>
                    ) : null}
                  </div>
                  {launcher.description ? (
                    <p className="mt-1 text-[12px] text-muted-foreground">{launcher.description}</p>
                  ) : null}
                </div>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-medium",
                    launcher.health.status === "healthy"
                      ? "bg-emerald-500/10 text-emerald-400"
                      : launcher.health.status === "configured"
                        ? "bg-blue-500/10 text-blue-300"
                        : launcher.health.status === "error"
                          ? "bg-red-500/10 text-red-300"
                          : "bg-amber-500/10 text-amber-300"
                  )}
                >
                  {launcher.health.status}
                </span>
              </div>

              <div className="mt-3 space-y-2 text-[11px] text-muted-foreground">
                <p>
                  <span className="text-foreground">Command:</span>{" "}
                  <code>{launcher.command}</code>
                  {launcher.args.length > 0 ? <> <code>{launcher.args.join(" ")}</code></> : null}
                </p>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full border border-border px-2 py-0.5">transport: {launcher.transport}</span>
                  <span className="rounded-full border border-border px-2 py-0.5">cwd: {launcher.cwdBase}</span>
                  <span className="rounded-full border border-border px-2 py-0.5">prompt: {launcher.promptMethod}</span>
                  {launcher.requiredVars.map((value) => (
                    <span key={value} className="rounded-full border border-border px-2 py-0.5">
                      requires vars.{value}
                    </span>
                  ))}
                </div>
                <p>{launcher.health.message}</p>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                <div className="rounded-lg bg-background/70 px-3 py-2">
                  <p className="text-muted-foreground">Agents</p>
                  <p className="mt-1 text-[13px] font-semibold text-foreground">{launcher.usage.agentCount}</p>
                </div>
                <div className="rounded-lg bg-background/70 px-3 py-2">
                  <p className="text-muted-foreground">Defaulted agents</p>
                  <p className="mt-1 text-[13px] font-semibold text-foreground">{launcher.usage.defaultedAgentCount}</p>
                </div>
                <div className="rounded-lg bg-background/70 px-3 py-2">
                  <p className="text-muted-foreground">Job overrides</p>
                  <p className="mt-1 text-[13px] font-semibold text-foreground">{launcher.usage.jobOverrideCount}</p>
                </div>
                <div className="rounded-lg bg-background/70 px-3 py-2">
                  <p className="text-muted-foreground">Legacy provider fallbacks</p>
                  <p className="mt-1 text-[13px] font-semibold text-foreground">{launcher.usage.legacyProviderCount}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <h3 className="text-[14px] font-semibold text-foreground">Agent runtime summary</h3>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Per-agent editing still lives in the agent screens. This page shows what each agent will actually run with.
          </p>
        </div>
        <div className="space-y-3">
          {summary.agents.map((agent) => (
            <div key={agent.slug} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-[13px] font-semibold text-foreground">{agent.name}</h4>
                    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                      {agent.slug}
                    </span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-medium",
                        agent.active
                          ? "bg-emerald-500/10 text-emerald-400"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      {agent.active ? "active" : "paused"}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                    <span className="rounded-full border border-border px-2 py-0.5">launcher: {agent.launcherId}</span>
                    <span className="rounded-full border border-border px-2 py-0.5">source: {agent.launcherSource}</span>
                    <span className="rounded-full border border-border px-2 py-0.5">heartbeat: {agent.heartbeat}</span>
                    <span className="rounded-full border border-border px-2 py-0.5">jobs: {agent.jobCount}</span>
                    <span className="rounded-full border border-border px-2 py-0.5">job overrides: {agent.jobOverrideCount}</span>
                    <span className="rounded-full border border-border px-2 py-0.5">legacy fallbacks: {agent.jobLegacyProviderCount}</span>
                  </div>
                </div>
                <div className="min-w-[240px] rounded-lg bg-background/70 px-3 py-2 text-[11px] text-muted-foreground">
                  <p className="font-medium text-foreground">Stack file</p>
                  <p className="mt-1 break-all">{agent.stackFilePath || "Not stack-backed"}</p>
                  {agent.stackFilePath ? (
                    <p className="mt-1">
                      Status: {agent.stackFileExists ? "found" : "missing or unreadable"}
                    </p>
                  ) : null}
                </div>
              </div>

              {agent.issues.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {agent.issues.map((issue, index) => (
                    <div
                      key={`${agent.slug}-${issue.code}-${index}`}
                      className={cn("rounded-lg border p-3 text-[11px]", issueClasses(issue.severity))}
                    >
                      <p className="font-medium text-foreground">{issue.code.replaceAll("_", " ")}</p>
                      <p className="mt-1 text-muted-foreground">{issue.message}</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
