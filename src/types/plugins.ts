export type PluginKind = "ui-sandbox" | "bundle" | "trusted-sidecar";

export type PluginTrust = "sandboxed" | "trusted-local";

export type PluginSourceKind = "local-install" | "vault-dev" | "built-in";

export type PluginStatus = "disabled" | "enabled" | "needs_review" | "error";

export type PluginCapability =
  | "tree.read"
  | "page.read"
  | "page.create"
  | "page.write"
  | "page.delete"
  | "plugin.settings.read"
  | "plugin.settings.write"
  | "agents.read"
  | "agent.stack.read"
  | "agent.stack.write"
  | "runtime.summary.read"
  | "desktop.selectDirectory"
  | "daemon.health.read"
  | "daemon.session.read"
  | "daemon.session.create"
  | "desktop.restartDaemon"
  | "desktop.reloadKeybindings";

export type PluginIssueSeverity = "info" | "warning" | "error";

export interface PluginSettingsFieldOption {
  label: string;
  value: string;
}

export interface PluginSettingsField {
  key: string;
  label: string;
  type: "text" | "textarea" | "boolean" | "number" | "select";
  description?: string;
  default?: unknown;
  options?: PluginSettingsFieldOption[];
  secret?: boolean;
}

export interface PluginSettingsSchema {
  fields: PluginSettingsField[];
}

export interface PluginManifestView {
  id: string;
  title: string;
  slot: "workspace";
  entry: string;
}

export interface PluginManifestCommand {
  id: string;
  title: string;
  action: { type: "open_view"; viewId: string };
}

export interface PluginBundleOverlays {
  launchers?: string;
}

export interface PluginBundleContributions {
  extensions?: string[];
  skills?: string[];
  skillsets?: string[];
  overlays?: PluginBundleOverlays;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  apiVersion: 1;
  kind: PluginKind;
  description?: string;
  requestedCapabilities: {
    required: PluginCapability[];
    optional: PluginCapability[];
  };
  views?: PluginManifestView[];
  commands?: PluginManifestCommand[];
  settings?: {
    schema?: PluginSettingsSchema;
    entry?: string;
  };
  bundle?: PluginBundleContributions;
}

export interface PluginStateRecord {
  enabled: boolean;
  trust: PluginTrust;
  grantedCapabilities: PluginCapability[];
  settings: Record<string, unknown>;
  approvedManifestHash?: string;
  lastError?: string | null;
  lastEnabledAt?: string | null;
}

export interface PluginStateFile {
  version: 1;
  plugins: Record<string, PluginStateRecord>;
}

export interface PluginIssue {
  code: string;
  message: string;
  severity: PluginIssueSeverity;
}

export interface PluginSourceInfo {
  kind: PluginSourceKind;
  rootPath: string;
  pluginPath: string;
  readonly: boolean;
}

export interface InstalledPluginSummary {
  manifest: PluginManifest | null;
  manifestHash?: string | null;
  source: PluginSourceInfo;
  status: PluginStatus;
  state: PluginStateRecord;
  issues: PluginIssue[];
}
