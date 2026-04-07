import type { PluginCapability, PluginTrust } from "@/types/plugins";

export type PluginCapabilityAvailability =
  | "phase-1"
  | "phase-2"
  | "phase-3"
  | "phase-4";

export interface PluginCapabilityDefinition {
  id: PluginCapability;
  label: string;
  description: string;
  requiresTrust: PluginTrust;
  availability: PluginCapabilityAvailability;
  desktopOnly: boolean;
}

export const PLUGIN_CAPABILITY_DEFINITIONS = {
  "tree.read": {
    id: "tree.read",
    label: "Read tree",
    description: "Browse the current vault tree through host-managed APIs.",
    requiresTrust: "sandboxed",
    availability: "phase-1",
    desktopOnly: false,
  },
  "graph.read": {
    id: "graph.read",
    label: "Read graph",
    description: "Read the knowledge graph through the app host.",
    requiresTrust: "sandboxed",
    availability: "phase-1",
    desktopOnly: false,
  },
  "page.read": {
    id: "page.read",
    label: "Read pages",
    description: "Read page content through the app host.",
    requiresTrust: "sandboxed",
    availability: "phase-1",
    desktopOnly: false,
  },
  "page.create": {
    id: "page.create",
    label: "Create pages",
    description: "Create new pages through the app host.",
    requiresTrust: "sandboxed",
    availability: "phase-1",
    desktopOnly: false,
  },
  "page.write": {
    id: "page.write",
    label: "Write pages",
    description: "Save updates to existing pages through the app host.",
    requiresTrust: "sandboxed",
    availability: "phase-1",
    desktopOnly: false,
  },
  "page.delete": {
    id: "page.delete",
    label: "Delete pages",
    description: "Delete pages through the app host.",
    requiresTrust: "sandboxed",
    availability: "phase-1",
    desktopOnly: false,
  },
  "plugin.settings.read": {
    id: "plugin.settings.read",
    label: "Read plugin settings",
    description: "Read the plugin's own saved settings.",
    requiresTrust: "sandboxed",
    availability: "phase-1",
    desktopOnly: false,
  },
  "plugin.settings.write": {
    id: "plugin.settings.write",
    label: "Write plugin settings",
    description: "Update the plugin's own saved settings.",
    requiresTrust: "sandboxed",
    availability: "phase-1",
    desktopOnly: false,
  },
  "agents.read": {
    id: "agents.read",
    label: "Read agents",
    description: "List and inspect agent records through existing agent APIs.",
    requiresTrust: "sandboxed",
    availability: "phase-1",
    desktopOnly: false,
  },
  "agent.stack.read": {
    id: "agent.stack.read",
    label: "Read agent stacks",
    description: "Read stack data for agents through the app host.",
    requiresTrust: "sandboxed",
    availability: "phase-1",
    desktopOnly: false,
  },
  "agent.stack.write": {
    id: "agent.stack.write",
    label: "Write agent stacks",
    description: "Save stack data for agents through the app host.",
    requiresTrust: "sandboxed",
    availability: "phase-1",
    desktopOnly: false,
  },
  "runtime.summary.read": {
    id: "runtime.summary.read",
    label: "Read runtime summary",
    description: "Read runtime health and configuration summaries.",
    requiresTrust: "sandboxed",
    availability: "phase-1",
    desktopOnly: false,
  },
  "desktop.selectDirectory": {
    id: "desktop.selectDirectory",
    label: "Select directory",
    description: "Open a native directory picker in the desktop app.",
    requiresTrust: "sandboxed",
    availability: "phase-2",
    desktopOnly: true,
  },
  "daemon.health.read": {
    id: "daemon.health.read",
    label: "Read daemon health",
    description: "Read daemon health details through trusted host mediation.",
    requiresTrust: "trusted-local",
    availability: "phase-4",
    desktopOnly: false,
  },
  "daemon.session.read": {
    id: "daemon.session.read",
    label: "Read daemon sessions",
    description: "Inspect daemon session state through trusted host mediation.",
    requiresTrust: "trusted-local",
    availability: "phase-4",
    desktopOnly: false,
  },
  "daemon.session.create": {
    id: "daemon.session.create",
    label: "Create daemon sessions",
    description: "Create daemon-backed sessions through trusted host mediation.",
    requiresTrust: "trusted-local",
    availability: "phase-4",
    desktopOnly: false,
  },
  "desktop.restartDaemon": {
    id: "desktop.restartDaemon",
    label: "Restart daemon",
    description: "Restart the desktop daemon through a trusted host bridge.",
    requiresTrust: "trusted-local",
    availability: "phase-4",
    desktopOnly: true,
  },
  "desktop.reloadKeybindings": {
    id: "desktop.reloadKeybindings",
    label: "Reload keybindings",
    description: "Reload desktop keybindings through a trusted host bridge.",
    requiresTrust: "trusted-local",
    availability: "phase-4",
    desktopOnly: true,
  },
} satisfies Record<PluginCapability, PluginCapabilityDefinition>;

export const PLUGIN_CAPABILITIES = Object.values(PLUGIN_CAPABILITY_DEFINITIONS);

export const CURRENT_PLUGIN_CAPABILITY_PHASE: PluginCapabilityAvailability = "phase-1";

const CAPABILITY_PHASE_ORDER: PluginCapabilityAvailability[] = [
  "phase-1",
  "phase-2",
  "phase-3",
  "phase-4",
];

export const SUPPORTED_PLUGIN_CAPABILITIES = PLUGIN_CAPABILITIES.filter((capability) =>
  isPluginCapabilityAvailable(capability.id)
);

export function getPluginCapabilityDefinition(
  capability: PluginCapability
): PluginCapabilityDefinition {
  return PLUGIN_CAPABILITY_DEFINITIONS[capability];
}

export function isPluginCapability(value: string): value is PluginCapability {
  return value in PLUGIN_CAPABILITY_DEFINITIONS;
}

export function isPluginCapabilityAvailable(
  capability: PluginCapability,
  currentPhase: PluginCapabilityAvailability = CURRENT_PLUGIN_CAPABILITY_PHASE
): boolean {
  return (
    CAPABILITY_PHASE_ORDER.indexOf(getPluginCapabilityDefinition(capability).availability) <=
    CAPABILITY_PHASE_ORDER.indexOf(currentPhase)
  );
}
