export type CliLauncherTransport = "direct" | "tmux";

export interface CliLauncherPromptPtyWrite {
  method: "pty_write";
  when: "immediate" | "ready";
  readyPattern?: string;
  submit?: boolean;
}

export interface CliLauncherPromptArgv {
  method: "argv";
  promptArgs: string[];
}

export interface CliLauncherPromptNone {
  method: "none";
}

export type CliLauncherPromptDelivery =
  | CliLauncherPromptPtyWrite
  | CliLauncherPromptArgv
  | CliLauncherPromptNone;

export interface CliLauncherDefinition {
  id: string;
  label: string;
  command: string;
  args: string[];
  cwdBase?: "vault" | "runtime";
  env?: Record<string, string>;
  requiredVars?: string[];
  promptDelivery?: CliLauncherPromptDelivery;
  transport?: CliLauncherTransport;
  healthcheck?: {
    command?: string;
    args?: string[];
  };
}

export interface LauncherRegistryConfig {
  version: 1;
  defaultLauncherId: string;
  defaultTransport?: CliLauncherTransport;
  launchers: Record<string, CliLauncherDefinition>;
}

export interface AgentLaunchConfig {
  launcherId: string;
  cwd?: string;
  vars?: Record<string, string>;
  env?: Record<string, string>;
}

export interface JobExecutionConfig {
  inheritAgent?: boolean;
  launcherId?: string;
  cwd?: string;
  vars?: Record<string, string>;
  env?: Record<string, string>;
}

export interface ResolvedLaunchSpec {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  promptDelivery: CliLauncherPromptDelivery;
  transport: CliLauncherTransport;
}
