import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import type { PluginManifest } from "@/types/plugins";
import { readValidatedPluginDirectory } from "@/lib/plugins/plugin-manifest";

const suiteRoot = await fs.mkdtemp(path.join(os.tmpdir(), "yantra-plugin-manifest-"));

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

async function resetSuiteRoot() {
  await fs.rm(suiteRoot, { recursive: true, force: true });
  await fs.mkdir(suiteRoot, { recursive: true });
}

async function writePluginDir(input: {
  folderName: string;
  manifest?: PluginManifest | string;
  files?: Record<string, string>;
}) {
  const pluginRoot = path.join(suiteRoot, input.folderName);
  await fs.mkdir(pluginRoot, { recursive: true });

  if (typeof input.manifest === "string") {
    await fs.writeFile(path.join(pluginRoot, "plugin.json"), input.manifest, "utf-8");
  } else if (input.manifest) {
    await fs.writeFile(
      path.join(pluginRoot, "plugin.json"),
      `${JSON.stringify(input.manifest, null, 2)}\n`,
      "utf-8"
    );
  }

  for (const [relativePath, content] of Object.entries(input.files ?? {})) {
    const targetPath = path.join(pluginRoot, relativePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, content, "utf-8");
  }

  return pluginRoot;
}

beforeEach(async () => {
  await resetSuiteRoot();
});

afterAll(async () => {
  await fs.rm(suiteRoot, { recursive: true, force: true });
});

describe("plugin manifest validation", () => {
  test("reads a valid plugin directory", async () => {
    const pluginRoot = await writePluginDir({
      folderName: "valid-plugin",
      manifest: baseManifest(),
      files: {
        "index.html": "<html><body>plugin</body></html>",
      },
    });

    const result = await readValidatedPluginDirectory(pluginRoot);
    expect(result.manifest?.id).toBe("sample-plugin");
    expect(typeof result.manifestHash).toBe("string");
    expect(result.issues).toEqual([]);
  });

  test("reports a missing plugin manifest file", async () => {
    const pluginRoot = await writePluginDir({
      folderName: "missing-manifest",
      files: {
        "index.html": "<html></html>",
      },
    });

    const result = await readValidatedPluginDirectory(pluginRoot);
    expect(result.manifest).toBeNull();
    expect(result.manifestHash).toBeNull();
    expect(result.issues[0]?.code).toBe("manifest_read_failed");
  });

  test("reports invalid manifest json", async () => {
    const pluginRoot = await writePluginDir({
      folderName: "invalid-json",
      manifest: "{ not valid json }\n",
    });

    const result = await readValidatedPluginDirectory(pluginRoot);
    expect(result.manifest).toBeNull();
    expect(result.issues[0]?.code).toBe("manifest_read_failed");
  });

  test("reports missing html view entries as blocking issues", async () => {
    const pluginRoot = await writePluginDir({
      folderName: "missing-view-entry",
      manifest: baseManifest(),
    });

    const result = await readValidatedPluginDirectory(pluginRoot);
    expect(result.manifest?.id).toBe("sample-plugin");
    expect(result.issues.some((issue) => issue.code === "missing_view_entry")).toBe(true);
  });

  test("accepts valid open_view commands for declared views", async () => {
    const pluginRoot = await writePluginDir({
      folderName: "command-plugin",
      manifest: baseManifest({
        commands: [
          {
            id: "open-main",
            title: "Open Main View",
            action: { type: "open_view", viewId: "main" },
          },
        ],
      }),
      files: {
        "index.html": "<html><body>plugin</body></html>",
      },
    });

    const result = await readValidatedPluginDirectory(pluginRoot);
    expect(result.manifest?.commands).toEqual([
      {
        id: "open-main",
        title: "Open Main View",
        action: { type: "open_view", viewId: "main" },
      },
    ]);
    expect(result.issues).toEqual([]);
  });

  test("flags commands that reference missing views", async () => {
    const pluginRoot = await writePluginDir({
      folderName: "command-missing-view",
      manifest: baseManifest({
        commands: [
          {
            id: "open-secondary",
            title: "Open Secondary View",
            action: { type: "open_view", viewId: "secondary" },
          },
        ],
      }),
      files: {
        "index.html": "<html><body>plugin</body></html>",
      },
    });

    const result = await readValidatedPluginDirectory(pluginRoot);
    expect(result.manifest?.id).toBe("sample-plugin");
    expect(result.manifest?.commands).toBeUndefined();
    expect(result.issues.some((issue) => issue.code === "unknown_command_view")).toBe(true);
  });

  test("flags duplicate commands after id trimming", async () => {
    const pluginRoot = await writePluginDir({
      folderName: "command-duplicate-trimmed",
      manifest: baseManifest({
        commands: [
          {
            id: "open-main",
            title: "Open Main View",
            action: { type: "open_view", viewId: "main" },
          },
          {
            id: "  open-main  ",
            title: "Open Main View Again",
            action: { type: "open_view", viewId: "main" },
          },
        ],
      }),
      files: {
        "index.html": "<html><body>plugin</body></html>",
      },
    });

    const result = await readValidatedPluginDirectory(pluginRoot);
    expect(result.manifest?.commands).toEqual([
      {
        id: "open-main",
        title: "Open Main View",
        action: { type: "open_view", viewId: "main" },
      },
    ]);
    expect(result.issues.some((issue) => issue.code === "duplicate_command_id")).toBe(true);
  });

  test("accepts valid bundle plugins with declared contributions", async () => {
    const pluginRoot = await writePluginDir({
      folderName: "bundle-plugin",
      manifest: baseManifest({
        kind: "bundle",
        requestedCapabilities: { required: [], optional: [] },
        views: undefined,
        bundle: {
          extensions: ["extensions/git/index.ts"],
          skills: ["skills/release/SKILL.md"],
          skillsets: ["skillsets/incident-response.md"],
        },
      }),
      files: {
        "extensions/git/index.ts": "export default {};",
        "skills/release/SKILL.md": "# Skill",
        "skillsets/incident-response.md": "# Skillset",
      },
    });

    const result = await readValidatedPluginDirectory(pluginRoot);
    expect(result.manifest?.kind).toBe("bundle");
    expect(result.manifest?.bundle).toEqual({
      extensions: ["extensions/git/index.ts"],
      skills: ["skills/release/SKILL.md"],
      skillsets: ["skillsets/incident-response.md"],
    });
    expect(result.issues).toEqual([]);
  });

  test("flags bundle plugins without declared contributions", async () => {
    const pluginRoot = await writePluginDir({
      folderName: "bundle-without-contributions",
      manifest: baseManifest({
        kind: "bundle",
        requestedCapabilities: { required: [], optional: [] },
        views: undefined,
        bundle: {},
      }),
    });

    const result = await readValidatedPluginDirectory(pluginRoot);
    expect(result.manifest?.kind).toBe("bundle");
    expect(result.issues.some((issue) => issue.code === "missing_bundle_contributions")).toBe(
      true
    );
  });

  test("flags missing bundle contribution files", async () => {
    const pluginRoot = await writePluginDir({
      folderName: "missing-bundle-file",
      manifest: baseManifest({
        kind: "bundle",
        requestedCapabilities: { required: [], optional: [] },
        views: undefined,
        bundle: {
          skills: ["skills/release/SKILL.md"],
        },
      }),
    });

    const result = await readValidatedPluginDirectory(pluginRoot);
    expect(result.manifest?.kind).toBe("bundle");
    expect(result.issues.some((issue) => issue.code === "missing_bundle_contribution")).toBe(
      true
    );
  });

  test("flags invalid bundle contribution file types", async () => {
    const pluginRoot = await writePluginDir({
      folderName: "invalid-bundle-type",
      manifest: baseManifest({
        kind: "bundle",
        requestedCapabilities: { required: [], optional: [] },
        views: undefined,
        bundle: {
          extensions: ["extensions/git/index.html"],
        },
      }),
      files: {
        "extensions/git/index.html": "<html></html>",
      },
    });

    const result = await readValidatedPluginDirectory(pluginRoot);
    expect(result.manifest?.kind).toBe("bundle");
    expect(result.issues.some((issue) => issue.code === "invalid_bundle_contribution_type")).toBe(
      true
    );
  });

  test("flags invalid or duplicate bundle contribution paths", async () => {
    const pluginRoot = await writePluginDir({
      folderName: "invalid-bundle-paths",
      manifest: baseManifest({
        kind: "bundle",
        requestedCapabilities: { required: [], optional: [] },
        views: undefined,
        bundle: {
          skills: ["../escape.md", "skills/release/SKILL.md", "./skills/release/SKILL.md"],
        },
      }),
      files: {
        "skills/release/SKILL.md": "# Skill",
      },
    });

    const result = await readValidatedPluginDirectory(pluginRoot);
    expect(result.manifest).toBeNull();
    expect(result.issues.some((issue) => issue.code === "invalid_bundle_contribution_path")).toBe(
      true
    );
    expect(result.issues.some((issue) => issue.code === "duplicate_bundle_contribution")).toBe(
      true
    );
  });

  test("accepts valid bundle integrations overlays", async () => {
    const pluginRoot = await writePluginDir({
      folderName: "bundle-integrations-overlay",
      manifest: baseManifest({
        kind: "bundle",
        requestedCapabilities: { required: [], optional: [] },
        views: undefined,
        bundle: {
          overlays: {
            integrations: "integrations.json",
          },
        },
      }),
      files: {
        "integrations.json": JSON.stringify({ version: 1, mcp_servers: {} }, null, 2),
      },
    });

    const result = await readValidatedPluginDirectory(pluginRoot);
    expect(result.manifest?.bundle?.overlays).toEqual({
      integrations: "integrations.json",
    });
    expect(result.issues).toEqual([]);
  });

  test("flags missing bundle integrations overlay files", async () => {
    const pluginRoot = await writePluginDir({
      folderName: "missing-integrations-overlay",
      manifest: baseManifest({
        kind: "bundle",
        requestedCapabilities: { required: [], optional: [] },
        views: undefined,
        bundle: {
          overlays: {
            integrations: "integrations.json",
          },
        },
      }),
    });

    const result = await readValidatedPluginDirectory(pluginRoot);
    expect(result.manifest?.kind).toBe("bundle");
    expect(result.issues.some((issue) => issue.code === "missing_bundle_overlay")).toBe(true);
  });

  test("flags absolute integration overlay paths", async () => {
    const pluginRoot = await writePluginDir({
      folderName: "absolute-integrations-overlay",
      manifest: baseManifest({
        kind: "bundle",
        requestedCapabilities: { required: [], optional: [] },
        views: undefined,
        bundle: {
          overlays: {
            integrations: "/tmp/integrations.json",
          },
        },
      }),
    });

    const result = await readValidatedPluginDirectory(pluginRoot);
    expect(result.manifest).toBeNull();
    expect(result.issues.some((issue) => issue.code === "invalid_bundle_overlay_path")).toBe(true);
  });

  test("flags escaping integration overlay paths", async () => {
    const pluginRoot = await writePluginDir({
      folderName: "escaping-integrations-overlay",
      manifest: baseManifest({
        kind: "bundle",
        requestedCapabilities: { required: [], optional: [] },
        views: undefined,
        bundle: {
          overlays: {
            integrations: "../integrations.json",
          },
        },
      }),
    });

    const result = await readValidatedPluginDirectory(pluginRoot);
    expect(result.manifest).toBeNull();
    expect(result.issues.some((issue) => issue.code === "invalid_bundle_overlay_path")).toBe(true);
  });

  test("flags non-json integration overlay paths", async () => {
    const pluginRoot = await writePluginDir({
      folderName: "non-json-integrations-overlay",
      manifest: baseManifest({
        kind: "bundle",
        requestedCapabilities: { required: [], optional: [] },
        views: undefined,
        bundle: {
          overlays: {
            integrations: "integrations.txt",
          },
        },
      }),
      files: {
        "integrations.txt": "not json",
      },
    });

    const result = await readValidatedPluginDirectory(pluginRoot);
    expect(result.manifest).toBeNull();
    expect(result.issues.some((issue) => issue.code === "invalid_bundle_overlay_path")).toBe(true);
  });

  test("flags non-bundle plugins that declare integrations overlays", async () => {
    const pluginRoot = await writePluginDir({
      folderName: "ui-plugin-with-overlay",
      manifest: baseManifest({
        bundle: {
          overlays: {
            integrations: "integrations.json",
          },
        },
      }),
      files: {
        "index.html": "<html><body>plugin</body></html>",
        "integrations.json": JSON.stringify({ version: 1, mcp_servers: {} }, null, 2),
      },
    });

    const result = await readValidatedPluginDirectory(pluginRoot);
    expect(result.issues.some((issue) => issue.code === "bundle_contributions_not_supported")).toBe(
      true
    );
  });
});
