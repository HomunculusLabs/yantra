import { beforeEach, describe, expect, test } from "bun:test";
import {
  dispatchPluginBridgeRequest,
  getSupportedPluginBridgeMethods,
  pluginBridgeDependencies,
} from "@/lib/plugins/plugin-bridge";
import type { InstalledPluginSummary, PluginIssue } from "@/types/plugins";

const originalPluginBridgeDependencies = { ...pluginBridgeDependencies };
const savePluginStateRecordCalls: Array<{ pluginId: string; record: unknown }> = [];
const createPageCalls: Array<{ parentPath: string; title: string }> = [];
const writePageCalls: Array<{
  path: string;
  content: string;
  frontmatter: Record<string, unknown>;
}> = [];
const deleteNodeCalls: string[] = [];
const autoCommitCalls: Array<{ path: string; action: string }> = [];
const readAgentStackCalls: string[] = [];
const writeAgentStackCalls: Array<{ slug: string; stack: Record<string, unknown> }> = [];

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
          "graph.read",
          "page.read",
          "page.create",
          "page.write",
          "page.delete",
          "agents.read",
          "agent.stack.read",
          "agent.stack.write",
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
        "graph.read",
        "page.read",
        "page.create",
        "page.write",
        "page.delete",
        "agents.read",
        "agent.stack.read",
        "agent.stack.write",
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
  pluginBridgeDependencies.buildKnowledgeGraph = async () => ({
    nodes: [{ id: "notes/today.md", label: "Today" }],
    links: [],
    scope: { mode: "global" },
    cache: { fullIndexReady: true },
    stats: { nodeCount: 1, linkCount: 0, unresolvedCount: 0 },
  } as any);
  pluginBridgeDependencies.createPage = async (parentPath: string, title: string) => {
    createPageCalls.push({ parentPath, title });
    return parentPath ? `${parentPath}/New Page.md` : "New Page.md";
  };
  pluginBridgeDependencies.readPage = async (path: string) => ({
    path,
    requestedPath: path,
    backingPath: `/tmp/${path}`,
    kind: "markdown",
    editable: true,
    content: "hello",
    frontmatter: {},
  });
  pluginBridgeDependencies.writePage = async (
    path: string,
    content: string,
    frontmatter: Record<string, unknown>
  ) => {
    writePageCalls.push({ path, content, frontmatter });
  };
  pluginBridgeDependencies.deleteNode = async (path: string) => {
    deleteNodeCalls.push(path);
  };
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
  pluginBridgeDependencies.listPersonas = async () => [
    {
      slug: "editor",
      name: "Editor",
      role: "editor",
      active: true,
    },
  ] as any;
  pluginBridgeDependencies.listAgentStackCatalog = async () => ({
    extensions: [{ label: "Plugin Extension", path: "@plugin/sample-plugin/ext/index.ts", source: "plugin" }],
    skills: [],
    skillsets: [],
  });
  pluginBridgeDependencies.readAgentStack = async (slug: string) => {
    readAgentStackCalls.push(slug);
    return {
      stackPath: `agents/${slug}/stack.json`,
      stack: {
        paths: { primary: "notes" },
        skills: ["skills/release/SKILL.md"],
      },
    } as any;
  };
  pluginBridgeDependencies.writeAgentStack = async (
    slug: string,
    stack: Record<string, unknown>
  ) => {
    writeAgentStackCalls.push({ slug, stack });
    return {
      stackPath: `agents/${slug}/stack.json`,
      stack,
    } as any;
  };
  pluginBridgeDependencies.autoCommit = async (
    path: string,
    action: "Update" | "Add" | "Delete"
  ) => {
    autoCommitCalls.push({ path, action });
  };
  pluginBridgeDependencies.markGraphCacheDirty = () => {};
  pluginBridgeDependencies.markDataviewCacheDirty = () => {};
  pluginBridgeDependencies.syncGraphCacheAfterCreate = async () => {};
  pluginBridgeDependencies.syncGraphCacheAfterDelete = async () => {};
  pluginBridgeDependencies.syncGraphCacheAfterWrite = async () => {};
  pluginBridgeDependencies.syncDataviewCacheAfterCreate = async () => {};
  pluginBridgeDependencies.syncDataviewCacheAfterDelete = async () => {};
  pluginBridgeDependencies.syncDataviewCacheAfterWrite = async () => {};
  pluginBridgeDependencies.getFrontmatterTitle = () => "Previous Title";
  pluginBridgeDependencies.validatePluginSettingsPayload = defaultSettingsValidation;
  pluginBridgeDependencies.savePluginStateRecord = async (pluginId, record) => {
    savePluginStateRecordCalls.push({ pluginId, record });
    return record;
  };
  savePluginStateRecordCalls.length = 0;
  createPageCalls.length = 0;
  writePageCalls.length = 0;
  deleteNodeCalls.length = 0;
  autoCommitCalls.length = 0;
  readAgentStackCalls.length = 0;
  writeAgentStackCalls.length = 0;
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

  test("dispatches graph.read through the graph builder", async () => {
    const response = await dispatchPluginBridgeRequest({
      entryToken: "pek_123",
      viewId: "main",
      request: {
        requestId: "req-1b",
        method: "graph.read",
        params: {
          path: "notes/today.md",
          depth: 2,
        },
      },
    });

    expect(response).toEqual({
      requestId: "req-1b",
      ok: true,
      result: {
        nodes: [{ id: "notes/today.md", label: "Today" }],
        links: [],
        scope: { mode: "global" },
        cache: { fullIndexReady: true },
        stats: { nodeCount: 1, linkCount: 0, unresolvedCount: 0 },
      },
    });
  });

  test("returns invalid_params when graph.read depth is invalid", async () => {
    const response = await dispatchPluginBridgeRequest({
      entryToken: "pek_123",
      viewId: "main",
      request: {
        requestId: "req-1c",
        method: "graph.read",
        params: {
          depth: "deep",
        },
      },
    });

    expect(response).toEqual({
      requestId: "req-1c",
      ok: false,
      error: {
        code: "invalid_params",
        message: "graph.read depth must be a finite number when provided.",
      },
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
        method: "plugin.unsupported",
      },
    });

    expect(response).toEqual({
      requestId: "req-3",
      ok: false,
      error: {
        code: "unknown_method",
        message: "Plugin bridge method 'plugin.unsupported' is not supported.",
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

  test("creates pages through page.create and triggers page side effects", async () => {
    const response = await dispatchPluginBridgeRequest({
      entryToken: "pek_123",
      viewId: "main",
      request: {
        requestId: "req-6",
        method: "page.create",
        params: {
          parentPath: "notes",
          title: "New Page",
        },
      },
    });

    expect(response).toEqual({
      requestId: "req-6",
      ok: true,
      result: {
        newPath: "notes/New Page.md",
      },
    });
    expect(createPageCalls).toEqual([{ parentPath: "notes", title: "New Page" }]);
    expect(autoCommitCalls).toEqual([{ path: "notes/New Page.md", action: "Add" }]);
  });

  test("writes pages through page.write", async () => {
    const response = await dispatchPluginBridgeRequest({
      entryToken: "pek_123",
      viewId: "main",
      request: {
        requestId: "req-7",
        method: "page.write",
        params: {
          path: "notes/today.md",
          content: "updated",
          frontmatter: { title: "Today" },
        },
      },
    });

    expect(response).toEqual({
      requestId: "req-7",
      ok: true,
      result: { saved: true },
    });
    expect(writePageCalls).toEqual([
      {
        path: "notes/today.md",
        content: "updated",
        frontmatter: { title: "Today" },
      },
    ]);
    expect(autoCommitCalls).toEqual([{ path: "notes/today.md", action: "Update" }]);
  });

  test("deletes pages through page.delete", async () => {
    const response = await dispatchPluginBridgeRequest({
      entryToken: "pek_123",
      viewId: "main",
      request: {
        requestId: "req-8",
        method: "page.delete",
        params: {
          path: "notes/today.md",
        },
      },
    });

    expect(response).toEqual({
      requestId: "req-8",
      ok: true,
      result: { deleted: true },
    });
    expect(deleteNodeCalls).toEqual(["notes/today.md"]);
    expect(autoCommitCalls).toEqual([{ path: "notes/today.md", action: "Delete" }]);
  });

  test("lists agents through agents.read", async () => {
    const response = await dispatchPluginBridgeRequest({
      entryToken: "pek_123",
      viewId: "main",
      request: {
        requestId: "req-9",
        method: "agents.read",
      },
    });

    expect(response).toEqual({
      requestId: "req-9",
      ok: true,
      result: [
        {
          slug: "editor",
          name: "Editor",
          role: "editor",
          active: true,
        },
      ],
    });
  });

  test("reads agent stack data through agent.stack.read", async () => {
    const response = await dispatchPluginBridgeRequest({
      entryToken: "pek_123",
      viewId: "main",
      request: {
        requestId: "req-10",
        method: "agent.stack.read",
        params: {
          slug: "editor",
        },
      },
    });

    expect(response).toEqual({
      requestId: "req-10",
      ok: true,
      result: {
        stackPath: "agents/editor/stack.json",
        stack: {
          paths: { primary: "notes" },
          skills: ["skills/release/SKILL.md"],
        },
        catalog: {
          extensions: [
            {
              label: "Plugin Extension",
              path: "@plugin/sample-plugin/ext/index.ts",
              source: "plugin",
            },
          ],
          skills: [],
          skillsets: [],
        },
      },
    });
    expect(readAgentStackCalls).toEqual(["editor"]);
  });

  test("writes agent stack data through agent.stack.write", async () => {
    const response = await dispatchPluginBridgeRequest({
      entryToken: "pek_123",
      viewId: "main",
      request: {
        requestId: "req-11",
        method: "agent.stack.write",
        params: {
          slug: "editor",
          stack: {
            skills: ["@plugin/sample-plugin/skills/triage/SKILL.md"],
          },
        },
      },
    });

    expect(response).toEqual({
      requestId: "req-11",
      ok: true,
      result: {
        stackPath: "agents/editor/stack.json",
        stack: {
          skills: ["@plugin/sample-plugin/skills/triage/SKILL.md"],
        },
      },
    });
    expect(writeAgentStackCalls).toEqual([
      {
        slug: "editor",
        stack: {
          skills: ["@plugin/sample-plugin/skills/triage/SKILL.md"],
        },
      },
    ]);
  });

  test("reads merged plugin settings through plugin.settings.read", async () => {
    const response = await dispatchPluginBridgeRequest({
      entryToken: "pek_123",
      viewId: "main",
      request: {
        requestId: "req-12",
        method: "plugin.settings.read",
      },
    });

    expect(response).toEqual({
      requestId: "req-12",
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
        requestId: "req-13",
        method: "plugin.settings.write",
        params: {
          settings: {
            theme: "solarized",
          },
        },
      },
    });

    expect(response).toEqual({
      requestId: "req-13",
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
        requestId: "req-14",
        method: "plugin.settings.write",
        params: {
          settings: {
            unknown: "value",
          },
        },
      },
    });

    expect(response).toEqual({
      requestId: "req-14",
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
        requestId: "req-15",
        method: "runtime.summary.read",
      },
    });

    expect(response).toEqual({
      requestId: "req-15",
      ok: true,
      result: { runtime: "ok" },
    });
  });
});
