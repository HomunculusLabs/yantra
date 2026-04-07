import { beforeEach, describe, expect, mock, test } from "bun:test";

let resolveBundlePluginAssetByVirtualPathImpl: (input: {
  virtualPath: string;
}) => Promise<
  | {
      ok: true;
      absolutePath: string;
      relativePath: string;
      contributionKind: "extensions" | "skills" | "skillsets";
      plugin: unknown;
    }
  | {
      ok: false;
      status: 404 | 409;
      message: string;
    }
> = async () => ({
  ok: true,
  absolutePath: "/plugins/sample-plugin/skills/release/SKILL.md",
  relativePath: "skills/release/SKILL.md",
  contributionKind: "skills",
  plugin: {},
});
let readFileContentImpl: (path: string) => Promise<string> = async () =>
  "---\ntitle: Plugin Skill\n---\n\n# Plugin Skill\n";

mock.module("@/lib/plugins/plugin-manager", () => ({
  resolveBundlePluginAssetByVirtualPath: async (input: { virtualPath: string }) =>
    resolveBundlePluginAssetByVirtualPathImpl(input),
}));

mock.module("@/lib/storage/fs-operations", () => ({
  readFileContent: async (path: string) => readFileContentImpl(path),
}));

mock.module("@/lib/storage/page-io", () => ({
  readPage: async (virtualPath: string) => ({
    path: virtualPath,
    requestedPath: virtualPath,
    backingPath: `/vault/${virtualPath}`,
    kind: "markdown",
    editable: true,
    content: "vault page",
    frontmatter: { title: "Vault Page", created: "", modified: "", tags: [] },
  }),
  writePage: async () => {},
  createPage: async () => "New Page.md",
}));

mock.module("@/lib/storage/node-io", () => ({
  deleteNode: async () => {},
  moveNode: async () => "moved.md",
  renameNode: async () => "renamed.md",
}));

mock.module("@/lib/graph/build-graph", () => ({
  markGraphCacheDirty: () => {},
  syncGraphCacheAfterCreate: async () => {},
  syncGraphCacheAfterDelete: async () => {},
  syncGraphCacheAfterRenameOrMove: async () => {},
  syncGraphCacheAfterWrite: async () => {},
}));

mock.module("@/lib/markdown/page-index", () => ({
  markDataviewCacheDirty: () => {},
  syncDataviewCacheAfterCreate: async () => {},
  syncDataviewCacheAfterDelete: async () => {},
  syncDataviewCacheAfterRenameOrMove: async () => {},
  syncDataviewCacheAfterWrite: async () => {},
}));

mock.module("@/lib/git/git-service", () => ({
  autoCommit: async () => {},
}));

const { DELETE, GET, PATCH, PUT } = await import("@/app/api/pages/[...path]/route");

beforeEach(() => {
  resolveBundlePluginAssetByVirtualPathImpl = async () => ({
    ok: true,
    absolutePath: "/plugins/sample-plugin/skills/release/SKILL.md",
    relativePath: "skills/release/SKILL.md",
    contributionKind: "skills",
    plugin: {},
  });
  readFileContentImpl = async () => "---\ntitle: Plugin Skill\n---\n\n# Plugin Skill\n";
});

describe("/api/pages plugin bundle assets", () => {
  test("GET returns a synthetic read-only markdown page for plugin assets", async () => {
    const response = await GET(
      new Request("http://localhost/api/pages/@plugin/sample-plugin/skills/release/SKILL.md") as never,
      {
        params: Promise.resolve({
          path: ["@plugin", "sample-plugin", "skills", "release", "SKILL.md"],
        }),
      } as never
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      path: "@plugin/sample-plugin/skills/release/SKILL.md",
      requestedPath: "@plugin/sample-plugin/skills/release/SKILL.md",
      backingPath: "/plugins/sample-plugin/skills/release/SKILL.md",
      kind: "markdown",
      editable: false,
      content: "# Plugin Skill",
      frontmatter: {
        title: "Plugin Skill",
      },
    });
  });

  test("GET preserves plugin runtime-blocked errors", async () => {
    resolveBundlePluginAssetByVirtualPathImpl = async () => ({
      ok: false,
      status: 409,
      message: "Plugin 'sample-plugin' must be enabled before its bundle assets can be used.",
    });

    const response = await GET(
      new Request("http://localhost/api/pages/@plugin/sample-plugin/skills/release/SKILL.md") as never,
      {
        params: Promise.resolve({
          path: ["@plugin", "sample-plugin", "skills", "release", "SKILL.md"],
        }),
      } as never
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Plugin 'sample-plugin' must be enabled before its bundle assets can be used.",
    });
  });

  test("PUT rejects plugin bundle asset writes", async () => {
    const response = await PUT(
      new Request("http://localhost/api/pages/@plugin/sample-plugin/skills/release/SKILL.md", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "updated", frontmatter: {} }),
      }) as never,
      {
        params: Promise.resolve({
          path: ["@plugin", "sample-plugin", "skills", "release", "SKILL.md"],
        }),
      } as never
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Plugin bundle assets are read-only.",
    });
  });

  test("PATCH rejects plugin bundle asset mutations", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/pages/@plugin/sample-plugin/skills/release/SKILL.md", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rename: "Renamed.md" }),
      }) as never,
      {
        params: Promise.resolve({
          path: ["@plugin", "sample-plugin", "skills", "release", "SKILL.md"],
        }),
      } as never
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Plugin bundle assets are read-only.",
    });
  });

  test("DELETE rejects plugin bundle asset removal", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/pages/@plugin/sample-plugin/skills/release/SKILL.md", {
        method: "DELETE",
      }) as never,
      {
        params: Promise.resolve({
          path: ["@plugin", "sample-plugin", "skills", "release", "SKILL.md"],
        }),
      } as never
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Plugin bundle assets are read-only.",
    });
  });
});
