export type RuntimeIssueCode =
  | "daemon_unreachable"
  | "launcher_missing"
  | "required_var_missing"
  | "stack_file_missing"
  | "tmux_unavailable"
  | "legacy_job_provider_fallback"
  | "legacy_root_jobs_present";

export type RuntimeIssueSeverity = "info" | "warning" | "error";

export interface RuntimeIssue {
  code: RuntimeIssueCode;
  severity: RuntimeIssueSeverity;
  message: string;
}

export interface LauncherRuntimeHealth {
  status: "healthy" | "configured" | "unverified" | "error";
  message: string;
}

export interface LauncherRuntimeSummary {
  launcherId: string;
  label: string;
  description?: string;
  command: string;
  args: string[];
  cwdBase: "vault" | "runtime";
  transport: "direct" | "tmux";
  promptMethod: "pty_write" | "argv" | "none";
  requiredVars: string[];
  health: LauncherRuntimeHealth;
  usage: {
    agentCount: number;
    defaultedAgentCount: number;
    jobOverrideCount: number;
    legacyProviderCount: number;
    stackBackedAgentCount: number;
  };
}

export interface AgentRuntimeSummary {
  slug: string;
  name: string;
  active: boolean;
  heartbeat: string;
  launcherId: string;
  launcherSource: "persona.launcher.launcherId" | "registry.defaultLauncherId";
  stackFilePath: string | null;
  stackFileExists: boolean | null;
  jobCount: number;
  jobOverrideCount: number;
  jobLegacyProviderCount: number;
  issues: RuntimeIssue[];
}

export interface RuntimeSettingsSummary {
  daemon: {
    reachable: boolean;
    details?: {
      service: string;
      ptySessions: number;
      scheduledJobs: number;
      scheduledHeartbeats: number;
      absurdWorkerReady: boolean;
      tmuxAvailable?: boolean;
      restartPlan?: {
        activeSessionCount: number;
        directSessionCount: number;
        tmuxSessionCount: number;
        restoredTmuxSessionCount: number;
        preservableTmuxSessionCount: number;
        softSafe: boolean;
      };
    };
    error?: string;
  };
  registry: {
    configPath: string;
    defaultLauncherId: string;
    defaultTransport: "direct" | "tmux";
    launchers: LauncherRuntimeSummary[];
  };
  agents: AgentRuntimeSummary[];
  legacy: {
    rootJobCount: number;
    jobProviderFallbackCount: number;
  };
  issues: RuntimeIssue[];
}

export interface McpServerConfig {
  name: string;
  command: string;
  enabled: boolean;
  env: Record<string, string>;
  description?: string;
}

export interface IntegrationConfig {
  mcp_servers: Record<string, McpServerConfig>;
  notifications: {
    browser_push: boolean;
    telegram: { enabled: boolean; bot_token: string; chat_id: string };
    slack_webhook: { enabled: boolean; url: string };
    email: { enabled: boolean; frequency: "hourly" | "daily"; to: string };
    nextcloud_talk: {
      enabled: boolean;
      server_url: string;
      username: string;
      app_password: string;
      default_room_token: string;
    };
  };
  scheduling: {
    max_concurrent_agents: number;
    default_heartbeat_interval: string;
    active_hours: string;
    pause_on_error: boolean;
  };
}

export type StorageRouteKey =
  | "agents"
  | "skills"
  | "extensions"
  | "mcp"
  | "todo"
  | "tasks";

export interface StorageRouteConfig {
  path: string;
  recursive: boolean;
  resolvedPath?: string;
  exists?: boolean;
  indexedFileCount?: number;
  sampleFiles?: string[];
}

export interface RootsConfig {
  vaultRoot: string;
  runtimeRoot: string;
  storageRoutes: Record<StorageRouteKey, StorageRouteConfig>;
  effectiveRoots?: {
    vaultRoot: string;
    runtimeRoot: string;
  };
  configPath?: string;
  checks?: {
    vaultExists: boolean;
    runtimeExists: boolean;
  };
  restartRequired?: boolean;
}

export interface LauncherValidationIssue {
  path: string;
  message: string;
}

export interface NotificationTestResponse {
  ok: boolean;
  sent?: string[];
  message: string;
}

export interface DesktopDaemonInfo {
  available: boolean;
  healthUrl?: string;
  managed?: boolean;
  ready?: boolean;
  restarting?: boolean;
  restartingMode?: "soft" | "force" | null;
}

export interface BrowserDaemonStatus {
  reachable: boolean;
  error?: string | null;
}

export type ThemeMode = "light" | "dark";

export type ThemeVarKey =
  | "--background"
  | "--foreground"
  | "--card"
  | "--card-foreground"
  | "--popover"
  | "--popover-foreground"
  | "--primary"
  | "--primary-foreground"
  | "--secondary"
  | "--secondary-foreground"
  | "--muted"
  | "--muted-foreground"
  | "--accent"
  | "--accent-foreground"
  | "--destructive"
  | "--border"
  | "--input"
  | "--ring"
  | "--sidebar"
  | "--sidebar-foreground"
  | "--sidebar-primary"
  | "--sidebar-primary-foreground"
  | "--sidebar-accent"
  | "--sidebar-accent-foreground"
  | "--sidebar-border"
  | "--sidebar-ring";

export interface EditableThemeDefinition {
  name: string;
  label: string;
  type: ThemeMode;
  bodyFontId: string | null;
  headingFontId: string | null;
  vars: Record<ThemeVarKey, string>;
}

export interface ThemesConfigResponse {
  themes: EditableThemeDefinition[];
  configPath: string;
}

export interface ThemeValidationIssue {
  path: string;
  message: string;
}

export type SettingsTab =
  | "runtime"
  | "launchers"
  | "integrations"
  | "notifications"
  | "storage"
  | "themes";
