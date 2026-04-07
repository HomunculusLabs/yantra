import { TerminalSquare } from "lucide-react";
import type { RuntimeSettingsSummary, LauncherValidationIssue } from "@/types/settings";
import type { LauncherCatalogEntry, LauncherOverlayIssue } from "@/types/launchers";

export function LauncherRegistryTab({
  loading,
  runtimeSummary,
  value,
  onChange,
  availableLaunchers,
  overlayIssues,
  error,
  validationIssues,
}: {
  loading: boolean;
  runtimeSummary: RuntimeSettingsSummary | null;
  value: string;
  onChange: (value: string) => void;
  availableLaunchers: LauncherCatalogEntry[];
  overlayIssues: LauncherOverlayIssue[];
  error?: string | null;
  validationIssues?: LauncherValidationIssue[];
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <TerminalSquare className="mt-0.5 h-4 w-4 text-primary" />
          <div>
            <h3 className="text-[14px] font-semibold text-foreground">Launcher Registry</h3>
            <p className="mt-1 text-[12px] text-muted-foreground">
              This is the advanced global registry that defines launch commands. Agents typically pick a launcher from <code>persona.launcher.launcherId</code>, jobs can override with <code>execution.launcherId</code>, and the daemon executes the resolved command.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4 text-[12px] text-muted-foreground">
          <p className="font-medium text-foreground">Core fields</p>
          <ul className="mt-2 space-y-1.5 list-disc pl-4">
            <li><code>command</code> + <code>args</code> define what actually launches.</li>
            <li><code>cwdBase</code> chooses whether paths resolve from vault or runtime.</li>
            <li><code>env</code> and <code>requiredVars</code> control template expansion.</li>
          </ul>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 text-[12px] text-muted-foreground">
          <p className="font-medium text-foreground">Prompt delivery</p>
          <ul className="mt-2 space-y-1.5 list-disc pl-4">
            <li><code>promptDelivery.method</code> can be <code>pty_write</code>, <code>argv</code>, or <code>none</code>.</li>
            <li><code>transport</code> chooses direct PTY vs tmux.</li>
            <li><code>healthcheck</code> is optional but improves runtime status reporting.</li>
          </ul>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 text-[12px] text-muted-foreground">
          <p className="font-medium text-foreground">Effective defaults</p>
          <div className="mt-2 space-y-1.5">
            <p>Default launcher: <code>{runtimeSummary?.registry.defaultLauncherId || "—"}</code></p>
            <p>Default transport: <code>{runtimeSummary?.registry.defaultTransport || "—"}</code></p>
            <p className="break-all">Config path: <code>{runtimeSummary?.registry.configPath || "—"}</code></p>
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-[12px] text-red-200">
          <p className="font-medium text-foreground">Save blocked</p>
          <p className="mt-1 text-muted-foreground">{error}</p>
          {validationIssues && validationIssues.length > 0 ? (
            <ul className="mt-2 space-y-1 list-disc pl-4 text-[11px]">
              {validationIssues.map((issue, index) => (
                <li key={`${issue.path}-${index}`}>
                  <code>{issue.path}</code>: {issue.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4 text-[12px] text-muted-foreground">
          <p className="font-medium text-foreground">Effective launcher catalog</p>
          <p className="mt-1">
            {availableLaunchers.length} launcher{availableLaunchers.length === 1 ? "" : "s"} available at runtime.
          </p>
          <div className="mt-3 max-h-56 space-y-2 overflow-auto">
            {availableLaunchers.length === 0 ? (
              <p>No launchers loaded.</p>
            ) : (
              availableLaunchers.map((launcher) => (
                <div key={launcher.id} className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <code className="break-all text-[11px] text-foreground">{launcher.id}</code>
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                      {launcher.source.kind === "plugin"
                        ? `plugin · ${launcher.source.pluginName}`
                        : launcher.readOnly
                          ? "read-only"
                          : "owned"}
                    </span>
                  </div>
                  <p className="mt-1 text-foreground">{launcher.label}</p>
                  {launcher.description ? (
                    <p className="mt-1 text-[11px] text-muted-foreground">{launcher.description}</p>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 text-[12px] text-muted-foreground">
          <p className="font-medium text-foreground">Plugin overlay issues</p>
          <p className="mt-1">Read-only plugin launcher overlays that failed validation or loading appear here.</p>
          <div className="mt-3 max-h-56 space-y-2 overflow-auto">
            {overlayIssues.length === 0 ? (
              <p>No overlay issues.</p>
            ) : (
              overlayIssues.map((issue, index) => (
                <div key={`${issue.pluginId}-${index}`} className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-foreground">{issue.pluginName}</span>
                    <code className="text-[11px] text-muted-foreground">{issue.pluginId}</code>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">{issue.message}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-[13px] text-muted-foreground">Loading launcher registry...</p>
      ) : (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-[520px] w-full rounded-xl border border-border bg-card px-3 py-3 font-mono text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          spellCheck={false}
        />
      )}
    </div>
  );
}
