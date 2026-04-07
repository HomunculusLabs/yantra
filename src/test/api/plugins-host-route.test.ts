import { beforeEach, describe, expect, mock, test } from "bun:test";

let resolveHostedPluginViewImpl: (input: unknown) => Promise<unknown> = async () => ({
  ok: false as const,
  status: 404 as const,
  message: "not configured",
});
const resolveHostedPluginViewCalls: unknown[] = [];

mock.module("@/lib/plugins/plugin-manager", () => ({
  resolveHostedPluginView: async (input: unknown) => {
    resolveHostedPluginViewCalls.push(input);
    return resolveHostedPluginViewImpl(input);
  },
}));

const { GET } = await import("@/app/plugins/host/[entryKey]/[viewId]/route");

beforeEach(() => {
  resolveHostedPluginViewImpl = async () => ({
    ok: false as const,
    status: 404 as const,
    message: "not configured",
  });
  resolveHostedPluginViewCalls.length = 0;
});

describe("GET /plugins/host/[entryKey]/[viewId]", () => {
  test("returns a trusted host html document for a resolved plugin view", async () => {
    resolveHostedPluginViewImpl = async () => ({
      ok: true as const,
      entryKey: "plugin-entry-key",
      entryFilePath: "/tmp/plugin/index.html",
      plugin: {
        manifest: {
          id: "sample-plugin",
          name: "Sample Plugin",
          version: "1.0.0",
          kind: "ui-sandbox",
          apiVersion: 1,
          requestedCapabilities: {
            required: ["tree.read"],
            optional: [],
          },
        },
        state: {
          grantedCapabilities: ["tree.read"],
          trust: "sandboxed",
        },
      },
      view: {
        id: "main",
        title: "Main View",
        entry: "index.html",
      },
    });

    const response = await GET(
      new Request("http://localhost/plugins/host/pek_123/main"),
      {
        params: Promise.resolve({
          entryKey: "pek_123",
          viewId: "main",
        }),
      }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")?.includes("text/html")).toBe(true);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const csp = response.headers.get("content-security-policy");
    expect(csp?.includes("default-src 'none'")).toBe(true);
    expect(csp?.includes("script-src 'unsafe-inline'")).toBe(true);
    expect(csp?.includes("frame-src 'self'")).toBe(true);
    expect(csp?.includes("connect-src 'self'")).toBe(true);
    expect(csp?.includes("form-action 'none'")).toBe(true);

    const html = await response.text();
    expect(html).toContain("/api/plugins/runtime/pek_123/assets/index.html");
    expect(html).toContain("/api/plugins/runtime/pek_123/bridge/main");
    expect(html).toContain("yantra-plugin");
    expect(html).toContain("host.init");
    expect(html).toContain("supportedMethods");
    expect(html).toContain("X-Yantra-Plugin-Bridge");
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html.includes("allow-same-origin")).toBe(false);
    expect(html.includes("allow-forms")).toBe(false);
    expect(html.includes("allow-top-navigation")).toBe(false);
    expect(resolveHostedPluginViewCalls).toEqual([
      { entryToken: "pek_123", viewId: "main" },
    ]);
  });

  test("returns an html error shell for route resolution failures", async () => {
    resolveHostedPluginViewImpl = async () => ({
      ok: false as const,
      status: 409 as const,
      message: "Plugin 'sample-plugin' must be enabled before its views can be opened.",
    });

    const response = await GET(
      new Request("http://localhost/plugins/host/pek_123/main"),
      {
        params: Promise.resolve({
          entryKey: "pek_123",
          viewId: "main",
        }),
      }
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("content-type")?.includes("text/html")).toBe(true);

    const html = await response.text();
    expect(html).toContain("Plugin view unavailable");
    expect(html).toContain("must be enabled before its views can be opened");
  });
});
