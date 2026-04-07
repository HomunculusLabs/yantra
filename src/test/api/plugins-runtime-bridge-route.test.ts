import { beforeEach, describe, expect, mock, test } from "bun:test";

let dispatchPluginBridgeRequestImpl: (input: unknown) => Promise<unknown> = async () => ({
  requestId: "req-1",
  ok: true as const,
  result: { ok: true },
});
const dispatchPluginBridgeRequestCalls: unknown[] = [];

mock.module("@/lib/plugins/plugin-bridge", () => ({
  dispatchPluginBridgeRequest: async (input: unknown) => {
    dispatchPluginBridgeRequestCalls.push(input);
    return dispatchPluginBridgeRequestImpl(input);
  },
  getSupportedPluginBridgeMethods: () => ["tree.read"],
}));

const {
  GET,
  POST,
} = await import("@/app/api/plugins/runtime/[entryKey]/bridge/[viewId]/route");

beforeEach(() => {
  dispatchPluginBridgeRequestImpl = async () => ({
    requestId: "req-1",
    ok: true as const,
    result: { ok: true },
  });
  dispatchPluginBridgeRequestCalls.length = 0;
});

describe("POST /api/plugins/runtime/[entryKey]/bridge/[viewId]", () => {
  test("returns 405 for unsupported methods", async () => {
    const response = await GET();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  test("rejects requests without the bridge header", async () => {
    const response = await POST(
      new Request("http://localhost/api/plugins/runtime/pek_123/bridge/main", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ requestId: "req-1", method: "tree.read" }),
      }),
      {
        params: Promise.resolve({
          entryKey: "pek_123",
          viewId: "main",
        }),
      }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Missing X-Yantra-Plugin-Bridge header.",
    });
  });

  test("passes valid bridge requests to the dispatcher", async () => {
    dispatchPluginBridgeRequestImpl = async () => ({
      requestId: "req-2",
      ok: false as const,
      error: {
        code: "runtime_blocked",
        message: "Plugin must be enabled before its views can be opened.",
      },
    });

    const response = await POST(
      new Request("http://localhost/api/plugins/runtime/pek_123/bridge/main", {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "X-Yantra-Plugin-Bridge": "1",
        },
        body: JSON.stringify({ requestId: "req-2", method: "tree.read" }),
      }),
      {
        params: Promise.resolve({
          entryKey: "pek_123",
          viewId: "main",
        }),
      }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      requestId: "req-2",
      ok: false,
      error: {
        code: "runtime_blocked",
        message: "Plugin must be enabled before its views can be opened.",
      },
    });
    expect(dispatchPluginBridgeRequestCalls).toEqual([
      {
        entryToken: "pek_123",
        viewId: "main",
        request: {
          requestId: "req-2",
          method: "tree.read",
        },
      },
    ]);
  });
});
