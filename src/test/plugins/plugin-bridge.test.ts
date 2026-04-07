import { beforeEach, describe, expect, test } from "bun:test";
import {
  dispatchPluginBridgeRequest,
  getSupportedPluginBridgeMethods,
  pluginBridgeDependencies,
} from "@/lib/plugins/plugin-bridge";
import type { InstalledPluginSummary, PluginIssue } from "@/types/plugins";

const originalPluginBridgeDependencies = { ...pluginBridgeDependencies };
const savePluginStateRecordCalls: Array<{ pluginId: string; record: unknown }> = [];

function defaultSettingsValidation(
  manifest: NonNullable<InstalledPluginSummary["manifest"]>,
  input: unknown
): { settings: Record<string, unknown>; issues: PluginIssue[] } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      settings: {},
      issues: [
        {
          code: "invalid_settings_payload",
          message: "Plugin settings payload must be an object.",
          severity: "error",
        },
      ],
    };
  }

  const allowedFields = manifest.settings?.schema?.fields ?? [];
  const allowedKeys = new Set(allowedFields.map((field) => field.key));
  const issues = Object.keys(input as Record<string, unknown>)
    .filter((key) => !allowedKeys.has(key))
    .map((key) => ({
      code: "unknown_settings_key",
      message: `Plugin settings key '${key}' is not declared.`,
      severity: "error" as const,
    }));

  const settings = Object.fromEntries(
    Object.entries(input as Record<string, unknown>).filter(([key]) => allowedKeys.has(key))
  );

  return { settings, issues };
}

function createResolvedPlugin(
  overrides: Partial<Omit<InstalledPluginSummary, "manifest">> & {
    manifest?: NonNullable<InstalledPluginSummary["manifest"]>;
  } = {}
): InstalledPluginSummary & { manifest: NonNullable<InstalledPluginSummary["manifest"]> } {
  return {
    manifest: {
      id: "sample-plugin",
      name: "Sample Plugin",
      version: "1.0.0",
      apiVersion: 1,
      kind: "ui-sandbox",
      requestedCapabilities: {
        required: ["tree.read"],
        optional: [
          "page.read",
          "plugin.settings.read",
          "plugin.settings.write",
          "runtime.summary.read",
        ],
      },
      views: [
        {
          id: "main",
          title: "Main",
          slot: "workspace",
          entry: "index.html",
        },
      ],
      settings: {
        schema: {
          fields: [
            {
              key: "theme",
              label: "Theme",
              type: "text",
              default: "dark",
            },
          ],
        },
      },
    },
    manifestHash: "manifest-hash",
    source: {
      kind: "local-install",
      rootPath: "/tmp/plugins",
      pluginPath: "/tmp/plugins/sample-plugin",
      readonly: false,
    },
    status: "enabled",
    state: {
      enabled: true,
      trust: "sandboxed",
      grantedCapabilities: [
        "tree.read",
        "page.read",
        "plugin.settings.read",
        "plugin.settings.write",
        "runtime.summary.read",
      ],
      settings: { theme: "light" },
      approvedManifestHash: "manifest-hash",
      lastError: null,
      lastEnabledAt: null,
    },
    issues: [],
    ...overrides,
  };
}

beforeEach(() => {
  Object.assign(pluginBridgeDependencies, originalPluginBridgeDependencies);
  pluginBridgeDependencies.resolveHostedPluginView = async () => ({
    ok: true as const,
    entryKey: "plugin-entry-key",
    entryFilePath: "/tmp/plugins/sample-plugin/index.html",
    plugin: createResolvedPlugin(),
    view: {
      id: "main",
      title: "Main",
      slot: "workspace",
      entry: "index.html",
    },
  });
  pluginBridgeDependencies.buildTree = async () => [];
  pluginBridgeDependencies.readPage = async (path: string) => ({
    path,
    requestedPath: path,
    backingPath: `/tmp/${path}`,
    kind: "markdown",
    editable: true,
    content: "hello",
    frontmatter: {},
  });
  pluginBridgeDependencies.buildRuntimeSettingsSummary = async () => ({ runtime: "ok" } as any);
  pluginBridgeDependencies.mergePluginSettingsWithDefaults = (
    manifest,
    settings
  ) => ({
    ...Object.fromEntries(
      (manifest.settings?.schema?.fields ?? []).map((field) => [field.key, field.default ?? null])
    ),
    ...settings,
  });
  pluginBridgeDependencies.validatePluginSettingsPayload = defaultSettingsValidation;
  pluginBridgeDependencies.savePluginStateRecord = async (pluginId, record) => {
    savePluginStateRecordCalls.push({ pluginId, record });
    return record;
  };
  savePluginStateRecordCalls.length = 0;
});

describe("plugin bridge dispatcher", () => {
  test("derives supported bridge methods from requested and granted capabilities", () => {
    const base = createResolvedPlugin();
    const methods = getSupportedPluginBridgeMethods({
      ...base,
      manifest: {
        ...base.manifest,
        requestedCapabilities: {
          required: ["tree.read"],
          optional: ["plugin.settings.read"],
        },
      },
      state: {
        ...base.state,
        grantedCapabilities: ["tree.read", "plugin.settings.read", "runtime.summary.read"],
      },
    });

    expect(methods).toEqual(["tree.read", "plugin.settings.read"]);
  });

  test("dispatches tree.read through the tree builder", async () => {
    pluginBridgeDependencies.buildTree = async () => [
      {
        name: "Notes",
        path: "notes",
        type: "directory",
        canOpen: true,
        frontmatter: { title: "Notes" },
        children: [
          {
            name: "Index.md",
            path: "notes/index.md",
            type: "file",
            canOpen: true,
            frontmatter: { title: "Index" },
          },
        ],
      },
    ];

    const response = await dispatchPluginBridgeRequest({
      entryToken: "pek_123",
      viewId: "main",
      request: {
        requestId: "req-1",
        method: "tree.read",
      },
    });

    expect(response).toEqual({
      requestId: "req-1",
      ok: true,
      result: [
        {
          path: "notes",
          title: "Notes",
          type: "directory",
          canOpen: true,
          children: [
            {
              path: "notes/index.md",
              title: "Index",
              type: "file",
              canOpen: true,
            },
          ],
        },
      ],
    });
  });

  test("returns runtime_blocked when hosted plugin resolution is blocked", async () => {
    pluginBridgeDependencies.resolveHostedPluginView = async () => ({
      ok: false as const,
      status: 409 as const,
      message: "Plugin must be enabled before its views can be opened.",
    });

    const response = await dispatchPluginBridgeRequest({
      entryToken: "pek_123",
      viewId: "main",
      request: {
        requestId: "req-2",
        method: "tree.read",
      },
    });

    expect(response).toEqual({
      requestId: "req-2",
      ok: false,
      error: {
        code: "runtime_blocked",
        message: "Plugin must be enabled before its views can be opened.",
      },
    });
  });

  test("returns unknown_method for unsupported methods", async () => {
    const response = await dispatchPluginBridgeRequest({
      entryToken: "pek_123",
      viewId: "main",
      request: {
        requestId: "req-3",
        method: "agent.stack.read",
      },
    });

    expect(response).toEqual({
      requestId: "req-3",
      ok: false,
      error: {
        code: "unknown_method",
        message: "Plugin bridge method 'agent.stack.read' is not supported.",
      },
    });
  });

  test("returns capability_not_granted when a known method is not callable", async () => {
    pluginBridgeDependencies.resolveHostedPluginView = async () => ({
      ok: true as const,
      entryKey: "plugin-entry-key",
      entryFilePath: "/tmp/plugins/sample-plugin/index.html",
      plugin: createResolvedPlugin({
        state: {
          ...createResolvedPlugin().state,
          grantedCapabilities: ["tree.read"],
        },
      }),
      view: {
        id: "main",
        title: "Main",
        slot: "workspace",
        entry: "index.html",
      },
    });

    const response = await dispatchPluginBridgeRequest({
      entryToken: "pek_123",
      viewId: "main",
      request: {
        requestId: "req-4",
        method: "plugin.settings.read",
      },
    });

    expect(response).toEqual({
      requestId: "req-4",
      ok: false,
      error: {
        code: "capability_not_granted",
        message: "Plugin bridge method 'plugin.settings.read' is not available for this plugin.",
      },
    });
  });

  test("returns invalid_params for runtime-prefixed page reads", async () => {
    const response = await dispatchPluginBridgeRequest({
      entryToken: "pek_123",
      viewId: "main",
      request: {
        requestId: "req-5",
        method: "page.read",
        params: {
          path: "@runtime/secret.md",
        },
      },
    });

    expect(response).toEqual({
      requestId: "req-5",
      ok: false,
      error: {
        code: "invalid_params",
        message: "page.read cannot access runtime-prefixed paths in phase 1.",
      },
    });
  });

  test("reads merged plugin settings through plugin.settings.read", async () => {
    const response = await dispatchPluginBridgeRequest({
      entryToken: "pek_123",
      viewId: "main",
      request: {
        requestId: "req-6",
        method: "plugin.settings.read",
      },
    });

    expect(response).toEqual({
      requestId: "req-6",
      ok: true,
      result: {
        theme: "light",
      },
    });
  });

  test("validates plugin.settings.write and persists a full settings replacement", async () => {
    const response = await dispatchPluginBridgeRequest({
      entryToken: "pek_123",
      viewId: "main",
      request: {
        requestId: "req-7",
        method: "plugin.settings.write",
        params: {
          settings: {
            theme: "solarized",
          },
        },
      },
    });

    expect(response).toEqual({
      requestId: "req-7",
      ok: true,
      result: { saved: true },
    });
    expect(savePluginStateRecordCalls.length).toBe(1);
    expect(savePluginStateRecordCalls[0]).toEqual({
      pluginId: "sample-plugin",
      record: {
        ...createResolvedPlugin().state,
        settings: {
          theme: "solarized",
        },
      },
    });
  });

  test("returns invalid_params when plugin.settings.write fails validation", async () => {
    const response = await dispatchPluginBridgeRequest({
      entryToken: "pek_123",
      viewId: "main",
      request: {
        requestId: "req-8",
        method: "plugin.settings.write",
        params: {
          settings: {
            unknown: "value",
          },
        },
      },
    });

    expect(response).toEqual({
      requestId: "req-8",
      ok: false,
      error: {
        code: "invalid_params",
        message: "Plugin settings payload failed validation.",
        details: [
          {
            code: "unknown_settings_key",
            message: "Plugin settings key 'unknown' is not declared.",
            severity: "error",
          },
        ],
      },
    });
  });

  test("reads runtime summary through runtime.summary.read", async () => {
    const response = await dispatchPluginBridgeRequest({
      entryToken: "pek_123",
      viewId: "main",
      request: {
        requestId: "req-9",
        method: "runtime.summary.read",
      },
    });

    expect(response).toEqual({
      requestId: "req-9",
      ok: true,
      result: { runtime: "ok" },
    });
  });
});
