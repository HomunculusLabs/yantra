import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";

const suiteRoot = await fs.mkdtemp(path.join(os.tmpdir(), "yantra-integrations-manager-"));
const vaultRoot = path.join(suiteRoot, "vault");
const runtimeRoot = path.join(suiteRoot, "runtime");
const runtimeConfigRoot = path.join(runtimeRoot, "config");
const pluginsRoot = path.join(suiteRoot, "plugins");

mock.module("@/lib/config/yantra-roots", () => ({
  getYantraRoots: () => ({
    vaultRoot,
    runtimeRoot,
    runtimeConfigRoot,
  }),
  ensureVaultRootExists: () => vaultRoot,
  ensureRuntimeRootExists: () => runtimeRoot,
  resolveRuntimePath: (relativePath: string) =>
    path.isAbsolute(relativePath) ? relativePath : path.resolve(runtimeRoot, relativePath),
  resolveVaultPath: (relativePath: string) =>
    path.isAbsolute(relativePath) ? relativePath : path.resolve(vaultRoot, relativePath),
}));

let overlayPlugins: Array<{
  manifest: {
    id: string;
    name: string;
    version: string;
    apiVersion: 1;
    kind: "bundle";
    requestedCapabilities: { required: string[]; optional: string[] };
    bundle: { overlays: { integrations: string } };
  };
  source: {
    pluginPath: string;
  };
}> = [];

mock.module("@/lib/plugins/plugin-manager", () => ({
  listEnabledIntegrationOverlayPlugins: async () => overlayPlugins,
}));

const {
  getDefaultIntegrationConfig,
  getIntegrationConfigReadResponse,
  loadEffectiveIntegrationConfig,
  saveIntegrationConfig,
} = await import("@/lib/agents/integrations-manager");

beforeEach(async () => {
  overlayPlugins = [];
  await fs.rm(suiteRoot, { recursive: true, force: true });
  await fs.mkdir(vaultRoot, { recursive: true });
  await fs.mkdir(runtimeConfigRoot, { recursive: true });
  await fs.mkdir(pluginsRoot, { recursive: true });
  await saveIntegrationConfig(getDefaultIntegrationConfig());
});

afterAll(async () => {
  await fs.rm(suiteRoot, { recursive: true, force: true });
});

describe("integrations-manager plugin MCP overlays", () => {
  test("merges valid plugin MCP overlays into the effective catalog only", async () => {
    const pluginRoot = path.join(pluginsRoot, "acme-tools");
    await fs.mkdir(pluginRoot, { recursive: true });
    await fs.writeFile(
      path.join(pluginRoot, "integrations.json"),
      `${JSON.stringify(
        {
          version: 1,
          mcp_servers: {
            ops: {
              name: "Ops MCP",
              command: "bunx --bun @acme/ops-mcp",
              env: { OPS_TOKEN: "" },
              description: "Plugin MCP",
            },
          },
        },
        null,
        2
      )}\n`,
      "utf-8"
    );

    overlayPlugins = [
      {
        manifest: {
          id: "acme-tools",
          name: "Acme Tools",
          version: "1.0.0",
          apiVersion: 1,
          kind: "bundle",
          requestedCapabilities: { required: [], optional: [] },
          bundle: { overlays: { integrations: "integrations.json" } },
        },
        source: { pluginPath: pluginRoot },
      },
    ];

    const response = await getIntegrationConfigReadResponse();
    const effectiveConfig = await loadEffectiveIntegrationConfig();

    expect(response.config.mcp_servers["@plugin/acme-tools/ops"]).toBeUndefined();
    const catalogEntry = response.availableMcpServers.find(
      (entry) => entry.id === "@plugin/acme-tools/ops"
    );
    expect(catalogEntry).toBeDefined();
    expect(catalogEntry?.name).toBe("Ops MCP");
    expect(catalogEntry?.command).toBe("bunx --bun @acme/ops-mcp");
    expect(catalogEntry?.readOnly).toBe(true);
    expect(catalogEntry?.source.kind).toBe("plugin");
    if (catalogEntry?.source.kind === "plugin") {
      expect(catalogEntry.source.pluginId).toBe("acme-tools");
      expect(catalogEntry.source.pluginName).toBe("Acme Tools");
      expect(catalogEntry.source.localId).toBe("ops");
    }
    expect(response.overlayIssues).toEqual([]);

    expect(effectiveConfig.mcp_servers["@plugin/acme-tools/ops"]?.name).toBe("Ops MCP");
    expect(effectiveConfig.mcp_servers["@plugin/acme-tools/ops"]?.enabled).toBe(true);
    expect(effectiveConfig.mcp_servers["@plugin/acme-tools/ops"]?.env).toEqual({ OPS_TOKEN: "" });
  });

  test("excludes invalid plugin MCP overlays and records issues", async () => {
    const pluginRoot = path.join(pluginsRoot, "broken-tools");
    await fs.mkdir(pluginRoot, { recursive: true });
    await fs.writeFile(
      path.join(pluginRoot, "integrations.json"),
      `${JSON.stringify(
        {
          version: 2,
          mcp_servers: {
            bad: {
              name: "Broken MCP",
              command: "bunx broken-mcp",
              enabled: true,
            },
          },
        },
        null,
        2
      )}\n`,
      "utf-8"
    );

    overlayPlugins = [
      {
        manifest: {
          id: "broken-tools",
          name: "Broken Tools",
          version: "1.0.0",
          apiVersion: 1,
          kind: "bundle",
          requestedCapabilities: { required: [], optional: [] },
          bundle: { overlays: { integrations: "integrations.json" } },
        },
        source: { pluginPath: pluginRoot },
      },
    ];

    const response = await getIntegrationConfigReadResponse();
    const effectiveConfig = await loadEffectiveIntegrationConfig();

    expect(response.config.mcp_servers["@plugin/broken-tools/bad"]).toBeUndefined();
    expect(
      response.availableMcpServers.some((entry) => entry.id === "@plugin/broken-tools/bad")
    ).toBe(false);
    expect(
      response.overlayIssues.some(
        (issue) =>
          issue.pluginId === "broken-tools" &&
          issue.message === "MCP overlay version must be 1."
      )
    ).toBe(true);
    expect(
      response.overlayIssues.some(
        (issue) =>
          issue.pluginId === "broken-tools" &&
          issue.message === "MCP overlay entry 'bad' cannot declare enabled."
      )
    ).toBe(true);
    expect(effectiveConfig.mcp_servers["@plugin/broken-tools/bad"]).toBeUndefined();
  });

  test("rejects duplicate overlay ids after normalization", async () => {
    const pluginRoot = path.join(pluginsRoot, "duplicate-tools");
    await fs.mkdir(pluginRoot, { recursive: true });
    await fs.writeFile(
      path.join(pluginRoot, "integrations.json"),
      `${JSON.stringify(
        {
          version: 1,
          mcp_servers: {
            ops: {
              name: "Ops MCP",
              command: "bunx ops-mcp",
            },
            "  ops  ": {
              name: "Ops MCP Duplicate",
              command: "bunx ops-mcp-duplicate",
            },
          },
        },
        null,
        2
      )}\n`,
      "utf-8"
    );

    overlayPlugins = [
      {
        manifest: {
          id: "duplicate-tools",
          name: "Duplicate Tools",
          version: "1.0.0",
          apiVersion: 1,
          kind: "bundle",
          requestedCapabilities: { required: [], optional: [] },
          bundle: { overlays: { integrations: "integrations.json" } },
        },
        source: { pluginPath: pluginRoot },
      },
    ];

    const response = await getIntegrationConfigReadResponse();
    const effectiveConfig = await loadEffectiveIntegrationConfig();

    expect(
      response.overlayIssues.some(
        (issue) =>
          issue.pluginId === "duplicate-tools" &&
          issue.message === "MCP overlay id '  ops  ' is duplicated after normalization."
      )
    ).toBe(true);
    expect(
      response.availableMcpServers.some((entry) => entry.id === "@plugin/duplicate-tools/ops")
    ).toBe(false);
    expect(effectiveConfig.mcp_servers["@plugin/duplicate-tools/ops"]).toBeUndefined();
  });

  test("strips plugin-owned MCP ids from the base config on load", async () => {
    const pluginRoot = path.join(pluginsRoot, "acme-tools");
    await fs.mkdir(pluginRoot, { recursive: true });
    await fs.writeFile(
      path.join(runtimeConfigRoot, "integrations.json"),
      `${JSON.stringify(
        {
          ...getDefaultIntegrationConfig(),
          mcp_servers: {
            ...getDefaultIntegrationConfig().mcp_servers,
            "@plugin/acme-tools/ops": {
              name: "Corrupted Owned Plugin Entry",
              command: "bunx corrupted-plugin-entry",
              enabled: false,
              env: {},
            },
          },
        },
        null,
        2
      )}\n`,
      "utf-8"
    );
    await fs.writeFile(
      path.join(pluginRoot, "integrations.json"),
      `${JSON.stringify(
        {
          version: 1,
          mcp_servers: {
            ops: {
              name: "Ops MCP",
              command: "bunx --bun @acme/ops-mcp",
            },
          },
        },
        null,
        2
      )}\n`,
      "utf-8"
    );

    overlayPlugins = [
      {
        manifest: {
          id: "acme-tools",
          name: "Acme Tools",
          version: "1.0.0",
          apiVersion: 1,
          kind: "bundle",
          requestedCapabilities: { required: [], optional: [] },
          bundle: { overlays: { integrations: "integrations.json" } },
        },
        source: { pluginPath: pluginRoot },
      },
    ];

    const response = await getIntegrationConfigReadResponse();
    const effectiveConfig = await loadEffectiveIntegrationConfig();

    expect(response.config.mcp_servers["@plugin/acme-tools/ops"]).toBeUndefined();
    const catalogEntry = response.availableMcpServers.find(
      (entry) => entry.id === "@plugin/acme-tools/ops"
    );
    expect(catalogEntry?.readOnly).toBe(true);
    expect(catalogEntry?.name).toBe("Ops MCP");
    expect(effectiveConfig.mcp_servers["@plugin/acme-tools/ops"]?.command).toBe(
      "bunx --bun @acme/ops-mcp"
    );
  });

  test("rejects plugin-owned MCP ids in the writable integrations config", async () => {
    const baseConfig = getDefaultIntegrationConfig();
    await expect(
      saveIntegrationConfig({
        ...baseConfig,
        mcp_servers: {
          ...baseConfig.mcp_servers,
          "@plugin/acme-tools/ops": {
            name: "Ops MCP",
            command: "bunx --bun @acme/ops-mcp",
            enabled: true,
            env: {},
          },
        },
      })
    ).rejects.toThrow(
      "Plugin-contributed MCP ids are read-only and cannot be saved into the owned integrations config"
    );
  });
});
