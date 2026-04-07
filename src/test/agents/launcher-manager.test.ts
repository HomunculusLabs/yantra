import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";

const suiteRoot = await fs.mkdtemp(path.join(os.tmpdir(), "yantra-launcher-manager-"));
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
  ensureRuntimeRootExists: () => runtimeRoot,
  ensureVaultRootExists: () => vaultRoot,
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
    bundle: { overlays: { launchers: string } };
  };
  source: {
    pluginPath: string;
  };
}> = [];

mock.module("@/lib/plugins/plugin-manager", () => ({
  listEnabledLauncherOverlayPlugins: async () => overlayPlugins,
}));

const {
  getLauncherRegistryReadResponse,
  loadEffectiveLauncherRegistry,
  resolveLaunchPreview,
  saveLauncherRegistry,
} = await import("@/lib/agents/launcher-manager");

beforeEach(async () => {
  overlayPlugins = [];
  await fs.rm(suiteRoot, { recursive: true, force: true });
  await fs.mkdir(vaultRoot, { recursive: true });
  await fs.mkdir(runtimeConfigRoot, { recursive: true });
  await fs.mkdir(pluginsRoot, { recursive: true });
  await saveLauncherRegistry({
    version: 1,
    defaultLauncherId: "claude-code",
    defaultTransport: "direct",
    launchers: {},
  });
});

afterAll(async () => {
  await fs.rm(suiteRoot, { recursive: true, force: true });
});

describe("launcher-manager phase 4 plugin overlays", () => {
  test("merges valid plugin launcher overlays into the effective runtime catalog only", async () => {
    const pluginRoot = path.join(pluginsRoot, "acme-tools");
    await fs.mkdir(pluginRoot, { recursive: true });
    await fs.writeFile(
      path.join(pluginRoot, "launchers.json"),
      `${JSON.stringify(
        {
          version: 1,
          launchers: {
            opus: {
              label: "Acme Opus",
              description: "Plugin launcher",
              command: "acme",
              args: ["chat"],
              transport: "direct",
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
          bundle: { overlays: { launchers: "launchers.json" } },
        },
        source: { pluginPath: pluginRoot },
      },
    ];

    const response = await getLauncherRegistryReadResponse();
    const effectiveRegistry = await loadEffectiveLauncherRegistry();

    expect(response.registry.launchers["@plugin/acme-tools/opus"]).toBeUndefined();
    const catalogEntry = response.availableLaunchers.find(
      (entry) => entry.id === "@plugin/acme-tools/opus"
    );
    expect(catalogEntry).toBeDefined();
    expect(catalogEntry?.label).toBe("Acme Opus");
    expect(catalogEntry?.readOnly).toBe(true);
    expect(catalogEntry?.source.kind).toBe("plugin");
    if (catalogEntry?.source.kind === "plugin") {
      expect(catalogEntry.source.pluginId).toBe("acme-tools");
      expect(catalogEntry.source.pluginName).toBe("Acme Tools");
      expect(catalogEntry.source.localId).toBe("opus");
    }
    expect(response.overlayIssues).toEqual([]);

    expect(effectiveRegistry.launchers["@plugin/acme-tools/opus"]?.id).toBe(
      "@plugin/acme-tools/opus"
    );
    expect(effectiveRegistry.launchers["@plugin/acme-tools/opus"]?.label).toBe("Acme Opus");
    expect(effectiveRegistry.launchers["@plugin/acme-tools/opus"]?.command).toBe("acme");
    expect(effectiveRegistry.launchers["@plugin/acme-tools/opus"]?.args).toEqual(["chat"]);

    const preview = await resolveLaunchPreview({
      persona: {
        launcher: {
          launcherId: "@plugin/acme-tools/opus",
        },
      } as never,
    });
    expect(preview.launcherId).toBe("@plugin/acme-tools/opus");
    expect(preview.command).toBe("acme");
    expect(preview.args).toEqual(["chat"]);
  });

  test("reports invalid plugin overlays and excludes them from the effective runtime catalog", async () => {
    const pluginRoot = path.join(pluginsRoot, "broken-tools");
    await fs.mkdir(pluginRoot, { recursive: true });
    await fs.writeFile(
      path.join(pluginRoot, "launchers.json"),
      `${JSON.stringify(
        {
          version: 2,
          defaultLauncherId: "codex",
          launchers: {
            bad: {
              label: "Broken Launcher",
              command: "broken",
              args: ["run"],
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
          bundle: { overlays: { launchers: "launchers.json" } },
        },
        source: { pluginPath: pluginRoot },
      },
    ];

    const response = await getLauncherRegistryReadResponse();
    const effectiveRegistry = await loadEffectiveLauncherRegistry();

    expect(response.availableLaunchers.some((entry) => entry.id === "@plugin/broken-tools/bad")).toBe(
      false
    );
    expect(
      response.overlayIssues.some(
        (issue) =>
          issue.pluginId === "broken-tools" &&
          issue.message === "Launcher overlay version must be 1."
      )
    ).toBe(true);
    expect(
      response.overlayIssues.some(
        (issue) =>
          issue.pluginId === "broken-tools" &&
          issue.message === "Launcher overlays cannot declare defaultLauncherId."
      )
    ).toBe(true);
    expect(effectiveRegistry.launchers["@plugin/broken-tools/bad"]).toBeUndefined();
  });

  test("uses a plugin-specific missing-launcher error when a plugin launcher id is unavailable", async () => {
    await expect(
      resolveLaunchPreview({
        persona: {
          launcher: {
            launcherId: "@plugin/acme-tools/missing",
          },
        } as never,
      })
    ).rejects.toThrow(
      "Plugin-contributed launcher not found or unavailable: @plugin/acme-tools/missing"
    );
  });
});
