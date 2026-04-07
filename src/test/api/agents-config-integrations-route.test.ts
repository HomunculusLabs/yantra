import { beforeEach, describe, expect, mock, test } from "bun:test";

let getIntegrationConfigReadResponseImpl: () => Promise<unknown> = async () => ({
  config: {
    mcp_servers: {},
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
  },
  availableMcpServers: [],
  overlayIssues: [],
});
let saveIntegrationConfigImpl: (input: unknown) => Promise<void> = async () => {};
const saveIntegrationConfigCalls: unknown[] = [];

mock.module("@/lib/agents/integrations-manager", () => ({
  getIntegrationConfigReadResponse: async () => getIntegrationConfigReadResponseImpl(),
  saveIntegrationConfig: async (input: unknown) => {
    saveIntegrationConfigCalls.push(input);
    await saveIntegrationConfigImpl(input);
  },
}));

const { GET, PUT } = await import("@/app/api/agents/config/integrations/route");

beforeEach(() => {
  getIntegrationConfigReadResponseImpl = async () => ({
    config: {
      mcp_servers: {},
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
    },
    availableMcpServers: [],
    overlayIssues: [],
  });
  saveIntegrationConfigImpl = async () => {};
  saveIntegrationConfigCalls.length = 0;
});

describe("/api/agents/config/integrations plugin MCP overlays", () => {
  test("GET returns the owned config plus plugin MCP catalog metadata", async () => {
    getIntegrationConfigReadResponseImpl = async () => ({
      config: {
        mcp_servers: {
          github: {
            name: "GitHub",
            command: "bunx --bun @mcp/github-server",
            enabled: false,
            env: { GITHUB_TOKEN: "" },
            description: "Create PRs, review code, manage issues",
          },
        },
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
      },
      availableMcpServers: [
        {
          id: "github",
          name: "GitHub",
          command: "bunx --bun @mcp/github-server",
          enabled: false,
          env: { GITHUB_TOKEN: "" },
          description: "Create PRs, review code, manage issues",
          readOnly: false,
          source: { kind: "owned" },
        },
        {
          id: "@plugin/acme-tools/ops",
          name: "Ops MCP",
          command: "bunx --bun @acme/ops-mcp",
          enabled: true,
          env: { OPS_TOKEN: "" },
          description: "Plugin MCP",
          readOnly: true,
          source: {
            kind: "plugin",
            pluginId: "acme-tools",
            pluginName: "Acme Tools",
            localId: "ops",
          },
        },
      ],
      overlayIssues: [
        {
          pluginId: "broken-tools",
          pluginName: "Broken Tools",
          message: "MCP overlay version must be 1.",
        },
      ],
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      config: {
        mcp_servers: {
          github: {
            name: "GitHub",
            command: "bunx --bun @mcp/github-server",
            enabled: false,
            env: { GITHUB_TOKEN: "" },
            description: "Create PRs, review code, manage issues",
          },
        },
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
      },
      availableMcpServers: [
        {
          id: "github",
          name: "GitHub",
          command: "bunx --bun @mcp/github-server",
          enabled: false,
          env: { GITHUB_TOKEN: "" },
          description: "Create PRs, review code, manage issues",
          readOnly: false,
          source: { kind: "owned" },
        },
        {
          id: "@plugin/acme-tools/ops",
          name: "Ops MCP",
          command: "bunx --bun @acme/ops-mcp",
          enabled: true,
          env: { OPS_TOKEN: "" },
          description: "Plugin MCP",
          readOnly: true,
          source: {
            kind: "plugin",
            pluginId: "acme-tools",
            pluginName: "Acme Tools",
            localId: "ops",
          },
        },
      ],
      overlayIssues: [
        {
          pluginId: "broken-tools",
          pluginName: "Broken Tools",
          message: "MCP overlay version must be 1.",
        },
      ],
    });
  });

  test("PUT saves the owned integrations config payload", async () => {
    const payload = {
      mcp_servers: {
        github: {
          name: "GitHub",
          command: "bunx --bun @mcp/github-server",
          enabled: true,
          env: { GITHUB_TOKEN: "test-token" },
        },
      },
      notifications: {
        browser_push: false,
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
        max_concurrent_agents: 4,
        default_heartbeat_interval: "*/30 * * * *",
        active_hours: "9-18",
        pause_on_error: true,
      },
    };

    const response = await PUT(
      new Request("http://localhost/api/agents/config/integrations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }) as never
    );

    expect(response.status).toBe(200);
    expect(saveIntegrationConfigCalls).toEqual([payload]);
    expect(await response.json()).toEqual({ ok: true });
  });

  test("PUT returns a manager error when saving fails", async () => {
    saveIntegrationConfigImpl = async () => {
      throw new Error(
        "Plugin-contributed MCP ids are read-only and cannot be saved into the owned integrations config"
      );
    };

    const response = await PUT(
      new Request("http://localhost/api/agents/config/integrations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mcp_servers: {
            "@plugin/acme-tools/ops": {
              name: "Ops MCP",
              command: "bunx --bun @acme/ops-mcp",
              enabled: true,
              env: {},
            },
          },
        }),
      }) as never
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error:
        "Error: Plugin-contributed MCP ids are read-only and cannot be saved into the owned integrations config",
    });
  });
});
