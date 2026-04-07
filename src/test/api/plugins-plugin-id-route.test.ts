import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { InstalledPluginSummary, PluginStateRecord } from "@/types/plugins";

let installedPlugin: InstalledPluginSummary | null = null;
const savePluginStateRecordCalls: Array<{ pluginId: string; record: PluginStateRecord }> = [];

mock.module("@/lib/plugins/plugin-manager", () => ({
  getInstalledPluginById: async () => installedPlugin,
}));

mock.module("@/lib/plugins/plugin-state-store", () => ({
  savePluginStateRecord: async (pluginId: string, record: PluginStateRecord) => {
    savePluginStateRecordCalls.push({ pluginId, record });
    if (installedPlugin) {
      installedPlugin = {
        ...installedPlugin,
        state: record,
      };
    }
    return record;
  },
}));

const { PATCH } = await import("@/app/api/plugins/[pluginId]/route");

function createInstalledPlugin(): InstalledPluginSummary {
  return {
    manifest: {
      id: "sample-plugin",
      name: "Sample Plugin",
      version: "1.0.0",
      apiVersion: 1,
      kind: "ui-sandbox",
      requestedCapabilities: {
        required: ["tree.read"],
        optional: ["desktop.selectDirectory"],
      },
      views: [
        {
          id: "main",
          title: "Main",
          slot: "workspace",
          entry: "index.html",
        },
      ],
    },
    manifestHash: "manifest-hash",
    source: {
      kind: "local-install",
      rootPath: "/tmp/plugins",
      pluginPath: "/tmp/plugins/sample-plugin",
      readonly: false,
    },
    status: "disabled",
    state: {
      enabled: false,
      trust: "sandboxed",
      grantedCapabilities: ["tree.read"],
      settings: {},
      approvedManifestHash: "manifest-hash",
      lastError: null,
      lastEnabledAt: null,
    },
    issues: [],
  };
}

beforeEach(() => {
  installedPlugin = createInstalledPlugin();
  savePluginStateRecordCalls.length = 0;
});

describe("PATCH /api/plugins/[pluginId]", () => {
  test("accepts phase-2 desktop capability grants", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/plugins/sample-plugin", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          grantedCapabilities: ["tree.read", "desktop.selectDirectory"],
        }),
      }) as any,
      {
        params: Promise.resolve({ pluginId: "sample-plugin" }),
      }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.state.grantedCapabilities).toEqual(["tree.read", "desktop.selectDirectory"]);
    expect(savePluginStateRecordCalls.length).toBe(1);
    expect(savePluginStateRecordCalls[0]?.pluginId).toBe("sample-plugin");
    expect(savePluginStateRecordCalls[0]?.record.grantedCapabilities).toEqual([
      "tree.read",
      "desktop.selectDirectory",
    ]);
  });
});
