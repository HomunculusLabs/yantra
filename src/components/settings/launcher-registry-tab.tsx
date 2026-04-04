import { TerminalSquare } from "lucide-react";
import type {
  LauncherValidationIssue,
  RuntimeSettingsSummary,
} from "@/types/settings";

export function LauncherRegistryTab({
  loading,
  runtimeSummary,
  value,
  onChange,
  error,
  validationIssues,
}: {
  loading: boolean;
  runtimeSummary: RuntimeSettingsSummary | null;
  value: string;
  onChange: (value: string) => void;
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
