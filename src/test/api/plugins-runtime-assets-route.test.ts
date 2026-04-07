import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";

let resolveHostedPluginAssetImpl: (input: unknown) => Promise<unknown> = async () => ({
  ok: false as const,
  status: 404 as const,
  message: "not configured",
});
const resolveHostedPluginAssetCalls: unknown[] = [];

mock.module("@/lib/plugins/plugin-manager", () => ({
  resolveHostedPluginAsset: async (input: unknown) => {
    resolveHostedPluginAssetCalls.push(input);
    return resolveHostedPluginAssetImpl(input);
  },
}));

const { GET } = await import("@/app/api/plugins/runtime/[entryKey]/assets/[...assetPath]/route");

const suiteRoot = await fs.mkdtemp(path.join(os.tmpdir(), "yantra-plugin-assets-route-"));

beforeEach(async () => {
  resolveHostedPluginAssetImpl = async () => ({
    ok: false as const,
    status: 404 as const,
    message: "not configured",
  });
  resolveHostedPluginAssetCalls.length = 0;
  await fs.rm(suiteRoot, { recursive: true, force: true });
  await fs.mkdir(suiteRoot, { recursive: true });
});

afterAll(async () => {
  await fs.rm(suiteRoot, { recursive: true, force: true });
});

describe("GET /api/plugins/runtime/[entryKey]/assets/[...assetPath]", () => {
  test("returns html assets with no-store, nosniff, narrowed CORS, and CSP", async () => {
    const htmlPath = path.join(suiteRoot, "index.html");
    await fs.writeFile(htmlPath, "<html><body>plugin</body></html>", "utf-8");
    resolveHostedPluginAssetImpl = async () => ({
      ok: true as const,
      plugin: {} as never,
      entryKey: "plugin-entry-key",
      relativePath: "index.html",
      absolutePath: htmlPath,
    });

    const response = await GET(
      new Request("http://localhost/api/plugins/runtime/pek_123/assets/index.html", {
        headers: { origin: "null" },
      }),
      {
        params: Promise.resolve({
          entryKey: "pek_123",
          assetPath: ["index.html"],
        }),
      }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")?.includes("text/html")).toBe(true);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("access-control-allow-origin")).toBe("null");
    expect(response.headers.get("vary")).toBe("Origin");
    const csp = response.headers.get("content-security-policy");
    expect(csp?.includes("default-src 'none'")).toBe(true);
    expect(csp?.includes("script-src 'self' 'unsafe-inline'")).toBe(true);
    expect(csp?.includes("connect-src 'none'")).toBe(true);
    expect(csp?.includes("form-action 'none'")).toBe(true);
    expect(csp?.includes("frame-ancestors 'self'")).toBe(true);
    expect(await response.text()).toContain("plugin");
    expect(resolveHostedPluginAssetCalls).toEqual([
      { entryToken: "pek_123", relativePath: "index.html" },
    ]);
  });

  test("returns non-html assets without an html CSP header", async () => {
    const jsPath = path.join(suiteRoot, "main.js");
    await fs.writeFile(jsPath, "console.log('plugin');", "utf-8");
    resolveHostedPluginAssetImpl = async () => ({
      ok: true as const,
      plugin: {} as never,
      entryKey: "plugin-entry-key",
      relativePath: "main.js",
      absolutePath: jsPath,
    });

    const response = await GET(
      new Request("http://localhost/api/plugins/runtime/pek_123/assets/main.js", {
        headers: { origin: "http://localhost" },
      }),
      {
        params: Promise.resolve({
          entryKey: "pek_123",
          assetPath: ["main.js"],
        }),
      }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")?.includes("application/javascript")).toBe(true);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost");
    expect(response.headers.get("vary")).toBe("Origin");
    expect(response.headers.get("content-security-policy")).toBeNull();
    expect(await response.text()).toContain("console.log");
  });

  test("preserves resolver failure statuses and error bodies", async () => {
    resolveHostedPluginAssetImpl = async () => ({
      ok: false as const,
      status: 404 as const,
      message: "Plugin asset was not found.",
    });

    const notFound = await GET(
      new Request("http://localhost/api/plugins/runtime/pek_123/assets/missing.js"),
      {
        params: Promise.resolve({
          entryKey: "pek_123",
          assetPath: ["missing.js"],
        }),
      }
    );

    expect(notFound.status).toBe(404);
    expect(await notFound.json()).toEqual({ error: "Plugin asset was not found." });

    resolveHostedPluginAssetImpl = async () => ({
      ok: false as const,
      status: 409 as const,
      message: "Plugin 'sample-plugin' must be enabled before its views can be opened.",
    });

    const blocked = await GET(
      new Request("http://localhost/api/plugins/runtime/pek_123/assets/index.html"),
      {
        params: Promise.resolve({
          entryKey: "pek_123",
          assetPath: ["index.html"],
        }),
      }
    );

    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toEqual({
      error: "Plugin 'sample-plugin' must be enabled before its views can be opened.",
    });
  });
});
