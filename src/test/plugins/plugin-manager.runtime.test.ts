import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import type { PluginManifest, PluginStateRecord } from "@/types/plugins";

const suiteRoot = await fs.mkdtemp(path.join(os.tmpdir(), "yantra-plugin-manager-"));
const vaultRoot = path.join(suiteRoot, "vault");
const runtimeRoot = path.join(suiteRoot, "runtime");
const configRoot = path.join(suiteRoot, "config");
const pluginsInstallDir = path.join(configRoot, "plugins");
const pluginsStatePath = path.join(configRoot, "plugins-state.json");
const vaultPluginsRoot = path.join(vaultRoot, ".plugins");

mock.module("@/lib/config/yantra-roots", () => ({
  getYantraRoots: () => ({
    vaultRoot,
    runtimeRoot,
  }),
  readYantraRootsConfig: () => ({
    vaultRoot,
    runtimeRoot,
    storageRoutes: {
      plugins: { path: ".plugins", recursive: false },
    },
  }),
  getYantraStorageRoutes: () => ({
    plugins: { path: ".plugins", recursive: false },
  }),
  resolveConfiguredVaultPath: (relativePath: string, root: string) =>
    path.resolve(root, relativePath),
  ensureVaultRootExists: () => {},
}));

mock.module("@/lib/config/app-paths", () => ({
  getYantraAppPaths: () => ({
    configRoot,
    pluginsInstallDir,
    pluginsStatePath,
  }),
}));

const pluginManager = await import("@/lib/plugins/plugin-manager");
const { getPluginCatalogEntryKey, getPluginCatalogEntryToken } = await import(
  "@/lib/plugins/plugin-entry-key"
);

const {
  hashPluginManifest,
  listEnabledBundlePlugins,
  listInstalledPlugins,
  resolveBundlePluginAsset,
  resolveHostedPluginAsset,
  resolveHostedPluginView,
} = pluginManager;

function baseManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: "sample-plugin",
    name: "Sample Plugin",
    version: "1.0.0",
    apiVersion: 1,
    kind: "ui-sandbox",
    requestedCapabilities: {
      required: ["tree.read"],
      optional: [],
    },
    views: [
      {
        id: "main",
        title: "Main",
        slot: "workspace",
        entry: "index.html",
      },
    ],
    ...overrides,
  };
}

function approvedState(
  manifest: PluginManifest,
  overrides: Partial<PluginStateRecord> = {}
): PluginStateRecord {
  return {
    enabled: true,
    trust: "sandboxed",
    grantedCapabilities: [...manifest.requestedCapabilities.required],
    settings: {},
    approvedManifestHash: hashPluginManifest(manifest),
    lastError: null,
    lastEnabledAt: null,
    ...overrides,
  };
}

async function resetSuiteRoots(): Promise<void> {
  await fs.rm(vaultRoot, { recursive: true, force: true });
  await fs.rm(runtimeRoot, { recursive: true, force: true });
  await fs.rm(configRoot, { recursive: true, force: true });
  await fs.mkdir(vaultPluginsRoot, { recursive: true });
  await fs.mkdir(pluginsInstallDir, { recursive: true });
}

async function writePluginFixture(input: {
  source: "local-install" | "vault-dev";
  folderName: string;
  manifest: PluginManifest;
  files?: Record<string, string>;
  directories?: string[];
}): Promise<{ pluginRoot: string }> {
  const parentRoot = input.source === "local-install" ? pluginsInstallDir : vaultPluginsRoot;
  const pluginRoot = path.join(parentRoot, input.folderName);
  await fs.mkdir(pluginRoot, { recursive: true });
  await fs.writeFile(
    path.join(pluginRoot, "plugin.json"),
    `${JSON.stringify(input.manifest, null, 2)}\n`,
    "utf-8"
  );

  for (const directory of input.directories ?? []) {
    await fs.mkdir(path.join(pluginRoot, directory), { recursive: true });
  }

  for (const [relativePath, content] of Object.entries(input.files ?? {})) {
    const absolutePath = path.join(pluginRoot, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content, "utf-8");
  }

  return { pluginRoot };
}

async function writeStateFile(
  records: Record<string, Partial<PluginStateRecord>>
): Promise<void> {
  await fs.mkdir(path.dirname(pluginsStatePath), { recursive: true });
  await fs.writeFile(
    pluginsStatePath,
    `${JSON.stringify(
      {
        version: 1,
        plugins: records,
      },
      null,
      2
    )}\n`,
    "utf-8"
  );
}

beforeEach(async () => {
  await resetSuiteRoots();
});

afterAll(async () => {
  await fs.rm(suiteRoot, { recursive: true, force: true });
});

describe("plugin-manager runtime resolution", () => {
  test("resolves an enabled approved html workspace view and its asset path", async () => {
    const manifest = baseManifest();
    const { pluginRoot } = await writePluginFixture({
      source: "local-install",
      folderName: "sample-plugin",
      manifest,
      files: {
        "index.html": "<html><body>plugin</body></html>",
        "main.js": "console.log('plugin');",
      },
    });
    await writeStateFile({
      [manifest.id]: approvedState(manifest),
    });

    const plugins = await listInstalledPlugins();
    expect(plugins.length).toBe(1);

    const plugin = plugins[0];
    expect(plugin?.status).toBe("enabled");
    expect(plugin?.issues).toEqual([]);

    if (!plugin) throw new Error("Expected discovered plugin");
    const entryKey = getPluginCatalogEntryKey(plugin);
    const entryToken = getPluginCatalogEntryToken(entryKey);

    const resolvedView = await resolveHostedPluginView({
      entryToken,
      viewId: "main",
    });
    expect(resolvedView.ok).toBe(true);
    if (!resolvedView.ok) throw new Error("Expected hosted plugin view resolution");
    expect(resolvedView.view.id).toBe("main");
    expect(resolvedView.entryFilePath).toBe(path.join(pluginRoot, "index.html"));

    const resolvedAsset = await resolveHostedPluginAsset({
      entryToken,
      relativePath: "index.html",
    });
    expect(resolvedAsset.ok).toBe(true);
    if (!resolvedAsset.ok) throw new Error("Expected hosted asset resolution");
    expect(resolvedAsset.absolutePath).toBe(path.join(pluginRoot, "index.html"));
    expect(resolvedAsset.relativePath).toBe("index.html");
  });

  test("treats duplicate plugin ids across discovery sources as runtime-blocking", async () => {
    const manifest = baseManifest();
    await writePluginFixture({
      source: "local-install",
      folderName: "sample-plugin-local",
      manifest,
      files: { "index.html": "<html>local</html>" },
    });
    await writePluginFixture({
      source: "vault-dev",
      folderName: "sample-plugin-vault",
      manifest,
      files: { "index.html": "<html>vault</html>" },
    });

    const plugins = await listInstalledPlugins();
    expect(plugins.length).toBe(2);
    for (const plugin of plugins) {
      expect(plugin.status).toBe("error");
      expect(plugin.issues.some((issue) => issue.code === "duplicate_plugin_id")).toBe(true);

      const entryToken = getPluginCatalogEntryToken(getPluginCatalogEntryKey(plugin));
      const resolved = await resolveHostedPluginView({
        entryToken,
        viewId: "main",
      });
      expect(resolved.ok).toBe(false);
      if (resolved.ok) throw new Error("Expected duplicate-id runtime block");
      expect(resolved.status).toBe(409);
    }
  });

  test("blocks runtime resolution when the plugin is not approved", async () => {
    const manifest = baseManifest();
    await writePluginFixture({
      source: "local-install",
      folderName: "sample-plugin",
      manifest,
      files: { "index.html": "<html>plugin</html>" },
    });

    const plugin = (await listInstalledPlugins())[0];
    if (!plugin) throw new Error("Expected discovered plugin");

    const resolved = await resolveHostedPluginView({
      entryToken: getPluginCatalogEntryToken(getPluginCatalogEntryKey(plugin)),
      viewId: "main",
    });

    expect(plugin.status).toBe("needs_review");
    expect(resolved.ok).toBe(false);
    if (resolved.ok) throw new Error("Expected approval gate");
    expect(resolved.status).toBe(409);
  });

  test("blocks runtime resolution when required grants are missing", async () => {
    const manifest = baseManifest();
    await writePluginFixture({
      source: "local-install",
      folderName: "sample-plugin",
      manifest,
      files: { "index.html": "<html>plugin</html>" },
    });
    await writeStateFile({
      [manifest.id]: approvedState(manifest, { grantedCapabilities: [] }),
    });

    const plugin = (await listInstalledPlugins())[0];
    if (!plugin) throw new Error("Expected discovered plugin");

    expect(plugin.status).toBe("disabled");
    expect(
      plugin.issues.some((issue) => issue.code === "missing_required_capabilities")
    ).toBe(true);

    const resolved = await resolveHostedPluginView({
      entryToken: getPluginCatalogEntryToken(getPluginCatalogEntryKey(plugin)),
      viewId: "main",
    });
    expect(resolved.ok).toBe(false);
    if (resolved.ok) throw new Error("Expected grant gate");
    expect(resolved.status).toBe(409);
  });

  test("blocks ui-sandbox runtime hosting for non-html entries", async () => {
    const manifest = baseManifest({
      views: [{ id: "main", title: "Main", slot: "workspace", entry: "main.js" }],
    });
    await writePluginFixture({
      source: "local-install",
      folderName: "sample-plugin",
      manifest,
      files: { "main.js": "console.log('plugin');" },
    });
    await writeStateFile({
      [manifest.id]: approvedState(manifest),
    });

    const plugin = (await listInstalledPlugins())[0];
    if (!plugin) throw new Error("Expected discovered plugin");

    expect(plugin.status).toBe("error");
    expect(plugin.issues.some((issue) => issue.code === "unsupported_view_entry")).toBe(true);

    const resolved = await resolveHostedPluginView({
      entryToken: getPluginCatalogEntryToken(getPluginCatalogEntryKey(plugin)),
      viewId: "main",
    });
    expect(resolved.ok).toBe(false);
    if (resolved.ok) throw new Error("Expected non-html runtime block");
    expect(resolved.status).toBe(409);
  });

  test("treats directory-backed view entries as invalid", async () => {
    const manifest = baseManifest({
      views: [{ id: "main", title: "Main", slot: "workspace", entry: "view" }],
    });
    await writePluginFixture({
      source: "local-install",
      folderName: "sample-plugin",
      manifest,
      directories: ["view"],
    });
    await writeStateFile({
      [manifest.id]: approvedState(manifest),
    });

    const plugin = (await listInstalledPlugins())[0];
    if (!plugin) throw new Error("Expected discovered plugin");

    expect(plugin.status).toBe("error");
    expect(plugin.issues.some((issue) => issue.code === "missing_view_entry")).toBe(true);

    const resolved = await resolveHostedPluginView({
      entryToken: getPluginCatalogEntryToken(getPluginCatalogEntryKey(plugin)),
      viewId: "main",
    });
    expect(resolved.ok).toBe(false);
    if (resolved.ok) throw new Error("Expected file-backed validation block");
    expect(resolved.status).toBe(409);
  });

  test("keeps bundle plugins enabled for catalog use but blocks runtime hosting", async () => {
    const manifest: PluginManifest = {
      id: "sample-plugin",
      name: "Sample Plugin",
      version: "1.0.0",
      apiVersion: 1,
      kind: "bundle",
      requestedCapabilities: { required: [], optional: [] },
      bundle: {
        extensions: ["extensions/git/index.ts"],
      },
    };
    await writePluginFixture({
      source: "local-install",
      folderName: "sample-plugin",
      manifest,
      files: {
        "extensions/git/index.ts": "export default {};",
      },
    });
    await writeStateFile({
      [manifest.id]: approvedState(manifest, { grantedCapabilities: [] }),
    });

    const plugin = (await listInstalledPlugins())[0];
    if (!plugin) throw new Error("Expected discovered plugin");

    expect(plugin.status).toBe("enabled");
    expect(plugin.issues).toEqual([]);
    expect((await listEnabledBundlePlugins()).map((entry) => entry.manifest.id)).toEqual([
      manifest.id,
    ]);

    const resolved = await resolveHostedPluginView({
      entryToken: getPluginCatalogEntryToken(getPluginCatalogEntryKey(plugin)),
      viewId: "main",
    });
    expect(resolved.ok).toBe(false);
    if (resolved.ok) throw new Error("Expected bundle runtime block");
    expect(resolved.status).toBe(409);
  });

  test("resolves only declared bundle plugin assets", async () => {
    const manifest: PluginManifest = {
      id: "sample-plugin",
      name: "Sample Plugin",
      version: "1.0.0",
      apiVersion: 1,
      kind: "bundle",
      requestedCapabilities: { required: [], optional: [] },
      bundle: {
        extensions: ["extensions/git/index.ts"],
        skills: ["skills/release/SKILL.md"],
      },
    };
    const { pluginRoot } = await writePluginFixture({
      source: "local-install",
      folderName: "sample-plugin",
      manifest,
      files: {
        "extensions/git/index.ts": "export default {};",
        "extensions/git/private.ts": "export const secret = true;",
        "skills/release/SKILL.md": "# Skill",
      },
    });
    await writeStateFile({
      [manifest.id]: approvedState(manifest, { grantedCapabilities: [] }),
    });

    const resolvedExtension = await resolveBundlePluginAsset({
      pluginId: manifest.id,
      relativePath: "extensions/git/index.ts",
    });
    expect(resolvedExtension.ok).toBe(true);
    if (!resolvedExtension.ok) throw new Error("Expected declared bundle asset");
    expect(resolvedExtension.absolutePath).toBe(path.join(pluginRoot, "extensions/git/index.ts"));
    expect(resolvedExtension.contributionKind).toBe("extensions");

    const undeclared = await resolveBundlePluginAsset({
      pluginId: manifest.id,
      relativePath: "extensions/git/private.ts",
    });
    expect(undeclared.ok).toBe(false);
    if (undeclared.ok) throw new Error("Expected undeclared bundle asset rejection");
    expect(undeclared.status).toBe(404);

    await fs.rm(path.join(pluginRoot, "skills/release/SKILL.md"), { force: true });
    const missing = await resolveBundlePluginAsset({
      pluginId: manifest.id,
      relativePath: "skills/release/SKILL.md",
    });
    expect(missing.ok).toBe(false);
    if (missing.ok) throw new Error("Expected missing bundle asset rejection");
    expect(missing.status).toBe(409);
  });

  test("rejects bundle asset resolution when the plugin is disabled", async () => {
    const manifest: PluginManifest = {
      id: "sample-plugin",
      name: "Sample Plugin",
      version: "1.0.0",
      apiVersion: 1,
      kind: "bundle",
      requestedCapabilities: { required: ["tree.read"], optional: [] },
      bundle: {
        extensions: ["extensions/git/index.ts"],
      },
    };
    await writePluginFixture({
      source: "local-install",
      folderName: "sample-plugin",
      manifest,
      files: {
        "extensions/git/index.ts": "export default {};",
      },
    });
    await writeStateFile({
      [manifest.id]: approvedState(manifest, { grantedCapabilities: [] }),
    });

    const resolved = await resolveBundlePluginAsset({
      pluginId: manifest.id,
      relativePath: "extensions/git/index.ts",
    });
    expect(resolved.ok).toBe(false);
    if (resolved.ok) throw new Error("Expected disabled bundle plugin rejection");
    expect(resolved.status).toBe(409);
  });

  test("rejects asset path traversal and absolute-path escapes", async () => {
    const manifest = baseManifest();
    await writePluginFixture({
      source: "local-install",
      folderName: "sample-plugin",
      manifest,
      files: {
        "index.html": "<html>plugin</html>",
        "subdir/app.js": "console.log('nested');",
      },
    });
    await writeStateFile({
      [manifest.id]: approvedState(manifest),
    });

    const plugin = (await listInstalledPlugins())[0];
    if (!plugin) throw new Error("Expected discovered plugin");
    const entryToken = getPluginCatalogEntryToken(getPluginCatalogEntryKey(plugin));

    const cases = [
      "../secret.txt",
      "/etc/passwd",
      "subdir/../../secret.txt",
      "subdir\\..\\..\\secret.txt",
    ];

    for (const relativePath of cases) {
      const resolved = await resolveHostedPluginAsset({ entryToken, relativePath });
      expect(resolved.ok).toBe(false);
      if (resolved.ok) throw new Error(`Expected traversal rejection for ${relativePath}`);
      expect(resolved.status).toBe(404);
    }
  });
});
