import path from "path";
import { getYantraRoots } from "@/lib/config/yantra-roots";
import { listEnabledIntegrationOverlayPlugins } from "@/lib/plugins/plugin-manager";
import { resolvePluginRelativePath } from "@/lib/plugins/plugin-manifest";
import {
  ensureDirectory,
  readFileContent,
  writeFileContent,
} from "@/lib/storage/fs-operations";
import type {
  IntegrationConfig,
  IntegrationConfigReadResponse,
  IntegrationOverlayIssue,
  McpCatalogEntry,
  McpServerConfig,
} from "@/types/settings";

const INTEGRATIONS_FILE = path.join(
  getYantraRoots().runtimeConfigRoot,
  "integrations.json"
);

const PLUGIN_MCP_ID_PREFIX = "@plugin/";

const DEFAULT_MCP_SERVERS: Record<string, McpServerConfig> = {
  reddit: {
    name: "Reddit",
    command: "bunx --bun @mcp/reddit-server",
    enabled: false,
    env: { REDDIT_CLIENT_ID: "", REDDIT_CLIENT_SECRET: "" },
    description: "Search, post, reply, monitor subreddits",
  },
  linkedin: {
    name: "LinkedIn",
    command: "bunx --bun @mcp/linkedin-server",
    enabled: false,
    env: { LINKEDIN_ACCESS_TOKEN: "" },
    description: "Post, connect, message, scrape profiles",
  },
  github: {
    name: "GitHub",
    command: "bunx --bun @mcp/github-server",
    enabled: false,
    env: { GITHUB_TOKEN: "" },
    description: "Create PRs, review code, manage issues",
  },
  slack: {
    name: "Slack",
    command: "bunx --bun @mcp/slack-server",
    enabled: false,
    env: { SLACK_BOT_TOKEN: "" },
    description: "Post to real Slack, read channels",
  },
  email: {
    name: "Email (SMTP)",
    command: "bunx --bun @mcp/email-server",
    enabled: false,
    env: { SMTP_HOST: "", SMTP_USER: "", SMTP_PASS: "" },
    description: "Send, read, categorize emails",
  },
  gsheets: {
    name: "Google Sheets",
    command: "bunx --bun @mcp/gsheets-server",
    enabled: false,
    env: { GOOGLE_CREDENTIALS: "" },
    description: "Read/write spreadsheets",
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneMcpServerConfig(config: McpServerConfig): McpServerConfig {
  return {
    ...config,
    env: { ...config.env },
  };
}

function isPluginMcpId(id: string): boolean {
  return id.startsWith(PLUGIN_MCP_ID_PREFIX);
}

function getPluginMcpId(pluginId: string, localId: string): string {
  return `${PLUGIN_MCP_ID_PREFIX}${pluginId}/${localId}`;
}

function sortMcpCatalogEntries(entries: McpCatalogEntry[]): McpCatalogEntry[] {
  return [...entries].sort((left, right) => {
    if (left.source.kind !== right.source.kind) {
      return left.source.kind === "owned" ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function validatePluginMcpOverlayFile(input: {
  pluginId: string;
  pluginName: string;
  content: unknown;
}): {
  servers: Record<string, McpServerConfig>;
  catalogEntries: McpCatalogEntry[];
  issues: IntegrationOverlayIssue[];
} {
  const issues: IntegrationOverlayIssue[] = [];
  const pushIssue = (message: string) => {
    issues.push({
      pluginId: input.pluginId,
      pluginName: input.pluginName,
      message,
    });
  };

  if (!isRecord(input.content)) {
    pushIssue("MCP overlay must be a JSON object.");
    return { servers: {}, catalogEntries: [], issues };
  }
  if (input.content.version !== 1) {
    pushIssue("MCP overlay version must be 1.");
  }
  if ("notifications" in input.content) {
    pushIssue("MCP overlays cannot declare notifications.");
  }
  if ("scheduling" in input.content) {
    pushIssue("MCP overlays cannot declare scheduling.");
  }
  if (!isRecord(input.content.mcp_servers)) {
    pushIssue("MCP overlay must define an mcp_servers object.");
    return { servers: {}, catalogEntries: [], issues };
  }

  const servers: Record<string, McpServerConfig> = {};
  const catalogEntries: McpCatalogEntry[] = [];
  for (const [localId, rawServer] of Object.entries(input.content.mcp_servers)) {
    if (!localId.trim() || localId.includes("/") || localId === "." || localId === "..") {
      pushIssue(`MCP overlay id '${localId}' is invalid.`);
      continue;
    }
    if (!isRecord(rawServer)) {
      pushIssue(`MCP overlay entry '${localId}' must be an object.`);
      continue;
    }
    if ("enabled" in rawServer) {
      pushIssue(`MCP overlay entry '${localId}' cannot declare enabled.`);
      continue;
    }
    if (typeof rawServer.name !== "string" || !rawServer.name.trim()) {
      pushIssue(`MCP overlay entry '${localId}' must define a non-empty name.`);
      continue;
    }
    if (typeof rawServer.command !== "string" || !rawServer.command.trim()) {
      pushIssue(`MCP overlay entry '${localId}' must define a non-empty command.`);
      continue;
    }
    if (rawServer.env !== undefined && !isStringRecord(rawServer.env)) {
      pushIssue(`MCP overlay entry '${localId}' must use string env values.`);
      continue;
    }

    const effectiveId = getPluginMcpId(input.pluginId, localId.trim());
    const server: McpServerConfig = {
      name: rawServer.name.trim(),
      command: rawServer.command.trim(),
      enabled: true,
      env: rawServer.env ? { ...rawServer.env } : {},
      ...(typeof rawServer.description === "string" && rawServer.description.trim()
        ? { description: rawServer.description.trim() }
        : {}),
    };
    servers[effectiveId] = server;
    catalogEntries.push({
      id: effectiveId,
      name: server.name,
      command: server.command,
      enabled: true,
      env: { ...server.env },
      description: server.description,
      readOnly: true,
      source: {
        kind: "plugin",
        pluginId: input.pluginId,
        pluginName: input.pluginName,
        localId: localId.trim(),
      },
    });
  }

  if (issues.length > 0) {
    return { servers: {}, catalogEntries: [], issues };
  }

  return { servers, catalogEntries, issues };
}

export function getDefaultIntegrationConfig(): IntegrationConfig {
  return {
    mcp_servers: Object.fromEntries(
      Object.entries(DEFAULT_MCP_SERVERS).map(([key, server]) => [
        key,
        cloneMcpServerConfig(server),
      ])
    ),
    notifications: {
      browser_push: true,
      telegram: { enabled: false, bot_token: "", chat_id: "" },
      slack_webhook: { enabled: false, url: "" },
      email: { enabled: false, frequency: "daily", to: "" },
      nextcloud_talk: {
        enabled: false,
        server_url: "",
        username: "",
        app_password: "",
        default_room_token: "",
      },
    },
    scheduling: {
      max_concurrent_agents: 10,
      default_heartbeat_interval: "*/15 * * * *",
      active_hours: "8-22",
      pause_on_error: true,
    },
  };
}

function normalizeEnv(
  input: unknown,
  defaults: Record<string, string>
): Record<string, string> {
  const env = { ...defaults };
  if (!isRecord(input)) return env;

  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }

  return env;
}

function normalizeMcpServer(
  key: string,
  input: unknown,
  fallback?: McpServerConfig
): McpServerConfig {
  const base = fallback
    ? cloneMcpServerConfig(fallback)
    : {
        name: key,
        command: "",
        enabled: false,
        env: {},
      };

  if (!isRecord(input)) return base;

  return {
    name: typeof input.name === "string" && input.name.trim() ? input.name : base.name,
    command:
      typeof input.command === "string" ? input.command : base.command,
    enabled: typeof input.enabled === "boolean" ? input.enabled : base.enabled,
    env: normalizeEnv(input.env, base.env),
    ...(typeof input.description === "string"
      ? { description: input.description }
      : base.description
        ? { description: base.description }
        : {}),
  };
}

export function normalizeIntegrationConfig(input: unknown): IntegrationConfig {
  const defaults = getDefaultIntegrationConfig();
  if (!isRecord(input)) return defaults;

  const normalizedServers: Record<string, McpServerConfig> = {};
  const inputServers = isRecord(input.mcp_servers) ? input.mcp_servers : {};
  const serverKeys = new Set([
    ...Object.keys(defaults.mcp_servers),
    ...Object.keys(inputServers),
  ]);

  for (const key of serverKeys) {
    normalizedServers[key] = normalizeMcpServer(
      key,
      inputServers[key],
      defaults.mcp_servers[key]
    );
  }

  const inputNotifications = isRecord(input.notifications)
    ? input.notifications
    : {};
  const inputScheduling = isRecord(input.scheduling) ? input.scheduling : {};
  const emailFrequency = inputNotifications.email;

  return {
    mcp_servers: normalizedServers,
    notifications: {
      browser_push:
        typeof inputNotifications.browser_push === "boolean"
          ? inputNotifications.browser_push
          : defaults.notifications.browser_push,
      telegram: {
        enabled:
          isRecord(inputNotifications.telegram) &&
          typeof inputNotifications.telegram.enabled === "boolean"
            ? inputNotifications.telegram.enabled
            : defaults.notifications.telegram.enabled,
        bot_token:
          isRecord(inputNotifications.telegram) &&
          typeof inputNotifications.telegram.bot_token === "string"
            ? inputNotifications.telegram.bot_token
            : defaults.notifications.telegram.bot_token,
        chat_id:
          isRecord(inputNotifications.telegram) &&
          typeof inputNotifications.telegram.chat_id === "string"
            ? inputNotifications.telegram.chat_id
            : defaults.notifications.telegram.chat_id,
      },
      slack_webhook: {
        enabled:
          isRecord(inputNotifications.slack_webhook) &&
          typeof inputNotifications.slack_webhook.enabled === "boolean"
            ? inputNotifications.slack_webhook.enabled
            : defaults.notifications.slack_webhook.enabled,
        url:
          isRecord(inputNotifications.slack_webhook) &&
          typeof inputNotifications.slack_webhook.url === "string"
            ? inputNotifications.slack_webhook.url
            : defaults.notifications.slack_webhook.url,
      },
      email: {
        enabled:
          isRecord(inputNotifications.email) &&
          typeof inputNotifications.email.enabled === "boolean"
            ? inputNotifications.email.enabled
            : defaults.notifications.email.enabled,
        frequency:
          isRecord(emailFrequency) &&
          (emailFrequency.frequency === "hourly" ||
            emailFrequency.frequency === "daily")
            ? emailFrequency.frequency
            : defaults.notifications.email.frequency,
        to:
          isRecord(inputNotifications.email) &&
          typeof inputNotifications.email.to === "string"
            ? inputNotifications.email.to
            : defaults.notifications.email.to,
      },
      nextcloud_talk: {
        enabled:
          isRecord(inputNotifications.nextcloud_talk) &&
          typeof inputNotifications.nextcloud_talk.enabled === "boolean"
            ? inputNotifications.nextcloud_talk.enabled
            : defaults.notifications.nextcloud_talk.enabled,
        server_url:
          isRecord(inputNotifications.nextcloud_talk) &&
          typeof inputNotifications.nextcloud_talk.server_url === "string"
            ? inputNotifications.nextcloud_talk.server_url
            : defaults.notifications.nextcloud_talk.server_url,
        username:
          isRecord(inputNotifications.nextcloud_talk) &&
          typeof inputNotifications.nextcloud_talk.username === "string"
            ? inputNotifications.nextcloud_talk.username
            : defaults.notifications.nextcloud_talk.username,
        app_password:
          isRecord(inputNotifications.nextcloud_talk) &&
          typeof inputNotifications.nextcloud_talk.app_password === "string"
            ? inputNotifications.nextcloud_talk.app_password
            : defaults.notifications.nextcloud_talk.app_password,
        default_room_token:
          isRecord(inputNotifications.nextcloud_talk) &&
          typeof inputNotifications.nextcloud_talk.default_room_token === "string"
            ? inputNotifications.nextcloud_talk.default_room_token
            : defaults.notifications.nextcloud_talk.default_room_token,
      },
    },
    scheduling: {
      max_concurrent_agents:
        typeof inputScheduling.max_concurrent_agents === "number" &&
        Number.isFinite(inputScheduling.max_concurrent_agents)
          ? inputScheduling.max_concurrent_agents
          : defaults.scheduling.max_concurrent_agents,
      default_heartbeat_interval:
        typeof inputScheduling.default_heartbeat_interval === "string"
          ? inputScheduling.default_heartbeat_interval
          : defaults.scheduling.default_heartbeat_interval,
      active_hours:
        typeof inputScheduling.active_hours === "string"
          ? inputScheduling.active_hours
          : defaults.scheduling.active_hours,
      pause_on_error:
        typeof inputScheduling.pause_on_error === "boolean"
          ? inputScheduling.pause_on_error
          : defaults.scheduling.pause_on_error,
    },
  };
}

export function getIntegrationConfigPath(): string {
  return INTEGRATIONS_FILE;
}

async function buildIntegrationConfigReadModel(
  baseConfig?: IntegrationConfig
): Promise<{
  config: IntegrationConfig;
  effectiveConfig: IntegrationConfig;
  availableMcpServers: McpCatalogEntry[];
  overlayIssues: IntegrationOverlayIssue[];
}> {
  const config = baseConfig ?? (await loadIntegrationConfig());
  const effectiveMcpServers = Object.fromEntries(
    Object.entries(config.mcp_servers).map(([id, server]) => [id, cloneMcpServerConfig(server)])
  );
  const availableMcpServers: McpCatalogEntry[] = Object.entries(config.mcp_servers).map(
    ([id, server]) => ({
      id,
      name: server.name,
      command: server.command,
      enabled: server.enabled,
      env: { ...server.env },
      description: server.description,
      readOnly: false,
      source: { kind: "owned" },
    })
  );
  const overlayIssues: IntegrationOverlayIssue[] = [];

  for (const plugin of await listEnabledIntegrationOverlayPlugins()) {
    const overlayPath = resolvePluginRelativePath(
      plugin.source.pluginPath,
      plugin.manifest.bundle.overlays.integrations
    );
    if (!overlayPath) {
      overlayIssues.push({
        pluginId: plugin.manifest.id,
        pluginName: plugin.manifest.name,
        message: `MCP overlay path '${plugin.manifest.bundle.overlays.integrations}' is invalid.`,
      });
      continue;
    }

    try {
      const validated = validatePluginMcpOverlayFile({
        pluginId: plugin.manifest.id,
        pluginName: plugin.manifest.name,
        content: JSON.parse(await readFileContent(overlayPath)),
      });
      overlayIssues.push(...validated.issues);
      Object.assign(effectiveMcpServers, validated.servers);
      availableMcpServers.push(...validated.catalogEntries);
    } catch (error) {
      overlayIssues.push({
        pluginId: plugin.manifest.id,
        pluginName: plugin.manifest.name,
        message:
          error instanceof Error
            ? `Failed to read MCP overlay: ${error.message}`
            : "Failed to read MCP overlay.",
      });
    }
  }

  return {
    config,
    effectiveConfig: {
      ...config,
      mcp_servers: effectiveMcpServers,
    },
    availableMcpServers: sortMcpCatalogEntries(availableMcpServers),
    overlayIssues,
  };
}

export async function loadIntegrationConfig(): Promise<IntegrationConfig> {
  try {
    const raw = await readFileContent(INTEGRATIONS_FILE);
    return normalizeIntegrationConfig(JSON.parse(raw));
  } catch {
    return getDefaultIntegrationConfig();
  }
}

export async function getIntegrationConfigReadResponse(): Promise<IntegrationConfigReadResponse> {
  const state = await buildIntegrationConfigReadModel();
  return {
    config: state.config,
    availableMcpServers: state.availableMcpServers,
    overlayIssues: state.overlayIssues,
  };
}

export async function loadEffectiveIntegrationConfig(): Promise<IntegrationConfig> {
  return (await buildIntegrationConfigReadModel()).effectiveConfig;
}

export async function saveIntegrationConfig(
  input: unknown
): Promise<IntegrationConfig> {
  if (isRecord(input) && isRecord(input.mcp_servers)) {
    const pluginOwnedIds = Object.keys(input.mcp_servers).filter((id) => isPluginMcpId(id));
    if (pluginOwnedIds.length > 0) {
      throw new Error(
        `Plugin-contributed MCP ids are read-only and cannot be saved into the owned integrations config: ${pluginOwnedIds.join(", ")}`
      );
    }
  }

  const normalized = normalizeIntegrationConfig(input);
  await ensureDirectory(path.dirname(INTEGRATIONS_FILE));
  await writeFileContent(
    INTEGRATIONS_FILE,
    `${JSON.stringify(normalized, null, 2)}\n`
  );
  return normalized;
}
