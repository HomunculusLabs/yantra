import type { AgentLaunchConfig } from "@/types/launchers";

export type BasicLauncherId = "claude-code" | "pi-agent-stack" | "codex";

export type LauncherModelOption = {
  value: string;
  label: string;
};

export const BASIC_LAUNCHER_OPTIONS: Array<{
  value: BasicLauncherId;
  label: string;
  description: string;
}> = [
  {
    value: "claude-code",
    label: "Claude",
    description: "Claude Code CLI",
  },
  {
    value: "pi-agent-stack",
    label: "PI",
    description: "Launch through pi-agent-stack and the linked pi-stack.json",
  },
  {
    value: "codex",
    label: "Codex",
    description: "OpenAI Codex CLI",
  },
];

const DEFAULT_MODEL_OPTION: LauncherModelOption = {
  value: "",
  label: "Default",
};

const CUSTOM_MODEL_OPTION: LauncherModelOption = {
  value: "__custom__",
  label: "Custom…",
};

const LAUNCHER_MODEL_OPTIONS: Record<BasicLauncherId, LauncherModelOption[]> = {
  "claude-code": [
    DEFAULT_MODEL_OPTION,
    { value: "sonnet", label: "Sonnet" },
    { value: "opus", label: "Opus" },
    { value: "haiku", label: "Haiku" },
    CUSTOM_MODEL_OPTION,
  ],
  "pi-agent-stack": [
    DEFAULT_MODEL_OPTION,
    { value: "sonnet", label: "Sonnet" },
    { value: "opus", label: "Opus" },
    { value: "haiku", label: "Haiku" },
    { value: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
    { value: "codex-mini-latest", label: "Codex Mini Latest" },
    { value: "o3", label: "o3" },
    CUSTOM_MODEL_OPTION,
  ],
  codex: [
    DEFAULT_MODEL_OPTION,
    { value: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
    { value: "gpt-5.1-codex-max", label: "GPT-5.1 Codex Max" },
    { value: "codex-mini-latest", label: "Codex Mini Latest" },
    { value: "o3", label: "o3" },
    CUSTOM_MODEL_OPTION,
  ],
};

export function isBasicLauncherId(value: unknown): value is BasicLauncherId {
  return value === "claude-code" || value === "pi-agent-stack" || value === "codex";
}

export function getBasicLauncherLabel(value: BasicLauncherId): string {
  return BASIC_LAUNCHER_OPTIONS.find((option) => option.value === value)?.label || value;
}

export function getLauncherModelOptions(
  launcherId: BasicLauncherId
): LauncherModelOption[] {
  return LAUNCHER_MODEL_OPTIONS[launcherId];
}

export function normalizeBasicLauncherId(
  launcher?: AgentLaunchConfig | null
): BasicLauncherId {
  return isBasicLauncherId(launcher?.launcherId)
    ? launcher.launcherId
    : "claude-code";
}

export function isPresetModelForLauncher(
  launcherId: BasicLauncherId,
  model?: string | null
): boolean {
  if (!model?.trim()) return true;
  return LAUNCHER_MODEL_OPTIONS[launcherId].some(
    (option) => option.value === model.trim()
  );
}
