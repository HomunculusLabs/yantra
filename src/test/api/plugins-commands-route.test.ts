import { beforeEach, describe, expect, mock, test } from "bun:test";

let listEnabledOpenViewCommandsImpl: () => Promise<unknown> = async () => [];

mock.module("@/lib/plugins/plugin-manager", () => ({
  listEnabledOpenViewCommands: async () => listEnabledOpenViewCommandsImpl(),
}));

const { GET } = await import("@/app/api/plugins/commands/route");

beforeEach(() => {
  listEnabledOpenViewCommandsImpl = async () => [];
});

describe("GET /api/plugins/commands", () => {
  test("returns enabled plugin open_view commands", async () => {
    listEnabledOpenViewCommandsImpl = async () => [
      {
        id: "@plugin/sample-plugin/commands/open-main",
        title: "Open Main View",
        pluginId: "sample-plugin",
        pluginName: "Sample Plugin",
        pluginEntryKey: "sample-plugin::local-install::root::plugin",
        viewId: "main",
      },
    ];

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      commands: [
        {
          id: "@plugin/sample-plugin/commands/open-main",
          title: "Open Main View",
          pluginId: "sample-plugin",
          pluginName: "Sample Plugin",
          pluginEntryKey: "sample-plugin::local-install::root::plugin",
          viewId: "main",
        },
      ],
    });
  });

  test("returns a 500 payload when command listing fails", async () => {
    listEnabledOpenViewCommandsImpl = async () => {
      throw new Error("plugin commands failed");
    };

    const response = await GET();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "plugin commands failed" });
  });
});
