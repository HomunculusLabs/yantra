import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";

let resolveVirtualContentPathImpl: (input: unknown) => Promise<unknown> = async () => ({
  ok: false as const,
  status: 404 as const,
  message: "not configured",
});
const resolveVirtualContentPathCalls: unknown[] = [];
const autoCommitCalls: Array<{ virtualPath: string; action: string }> = [];

mock.module("@/lib/storage/virtual-content-paths", () => ({
  resolveVirtualContentPath: async (input: unknown) => {
    resolveVirtualContentPathCalls.push(input);
    return resolveVirtualContentPathImpl(input);
  },
}));

mock.module("@/lib/git/git-service", () => ({
  autoCommit: (virtualPath: string, action: string) => {
    autoCommitCalls.push({ virtualPath, action });
  },
}));

const { GET, PUT } = await import("@/app/api/assets/[...path]/route");

const suiteRoot = await fs.mkdtemp(path.join(os.tmpdir(), "yantra-assets-route-"));

beforeEach(async () => {
  resolveVirtualContentPathCalls.length = 0;
  autoCommitCalls.length = 0;
  resolveVirtualContentPathImpl = async () => ({
    ok: false as const,
    status: 404 as const,
    message: "not configured",
  });
  await fs.rm(suiteRoot, { recursive: true, force: true });
  await fs.mkdir(suiteRoot, { recursive: true });
});

afterAll(async () => {
  await fs.rm(suiteRoot, { recursive: true, force: true });
});

describe("/api/assets/[...path] phase 3", () => {
  test("reads plugin-backed assets through the async resolver", async () => {
    const assetPath = path.join(suiteRoot, "plugin-skill.md");
    await fs.writeFile(assetPath, "# Plugin skill\n", "utf-8");
    resolveVirtualContentPathImpl = async () => ({
      ok: true as const,
      scope: "plugin" as const,
      virtualPath: "@plugin/acme-tools/skills/release/SKILL.md",
      absolutePath: assetPath,
      writable: false,
      pluginId: "acme-tools",
    });

    const response = await GET(
      new Request("http://localhost/api/assets/%40plugin/acme-tools/skills/release/SKILL.md") as never,
      {
        params: Promise.resolve({
          path: ["@plugin", "acme-tools", "skills", "release", "SKILL.md"],
        }),
      }
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Plugin skill");
    expect(resolveVirtualContentPathCalls).toEqual([
      {
        virtualPath: "@plugin/acme-tools/skills/release/SKILL.md",
        access: "read",
      },
    ]);
  });

  test("preserves resolver failures for plugin-backed reads", async () => {
    resolveVirtualContentPathImpl = async () => ({
      ok: false as const,
      status: 409 as const,
      message: "Plugin 'acme-tools' must be enabled before its bundle assets can be used.",
    });

    const response = await GET(
      new Request("http://localhost/api/assets/%40plugin/acme-tools/extensions/git/index.ts") as never,
      {
        params: Promise.resolve({
          path: ["@plugin", "acme-tools", "extensions", "git", "index.ts"],
        }),
      }
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Plugin 'acme-tools' must be enabled before its bundle assets can be used.",
    });
  });

  test("rejects plugin-backed writes as read-only", async () => {
    resolveVirtualContentPathImpl = async () => ({
      ok: false as const,
      status: 409 as const,
      message: "Plugin-backed paths are read-only.",
    });

    const response = await PUT(
      new Request("http://localhost/api/assets/%40plugin/acme-tools/extensions/git/index.ts", {
        method: "PUT",
        body: "export default {}",
      }) as never,
      {
        params: Promise.resolve({
          path: ["@plugin", "acme-tools", "extensions", "git", "index.ts"],
        }),
      }
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Plugin-backed paths are read-only." });
    expect(autoCommitCalls).toEqual([]);
    expect(resolveVirtualContentPathCalls).toEqual([
      {
        virtualPath: "@plugin/acme-tools/extensions/git/index.ts",
        access: "write",
      },
    ]);
  });
});
