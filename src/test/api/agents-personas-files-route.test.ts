import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";

const suiteRoot = await fs.mkdtemp(path.join(os.tmpdir(), "yantra-agent-files-route-"));
const vaultRoot = path.join(suiteRoot, "vault");
const runtimeRoot = path.join(suiteRoot, "runtime");
const stackVirtualPath = ".agents/stacks/sample.json";
const stackAbsolutePath = path.join(vaultRoot, stackVirtualPath);

mock.module("@/lib/config/yantra-roots", () => ({
  getYantraRoots: () => ({
    vaultRoot,
    runtimeRoot,
  }),
}));

mock.module("@/lib/agents/persona-manager", () => ({
  readPersona: async () => ({
    slug: "sample-agent",
    launcher: {
      vars: {
        stackFile: stackVirtualPath,
      },
    },
  }),
}));

mock.module("@/lib/agents/stack-manager", () => ({
  normalizeVaultRelativePath: (input: unknown, root: string) => {
    if (typeof input !== "string") return null;
    const trimmed = input.trim().replace(/^\.\//, "");
    if (!trimmed) return null;
    if (path.isAbsolute(trimmed)) {
      const resolved = path.resolve(trimmed);
      const normalizedRoot = path.resolve(root);
      if (resolved !== normalizedRoot && !resolved.startsWith(`${normalizedRoot}${path.sep}`)) {
        return null;
      }
      return path.relative(normalizedRoot, resolved).split(path.sep).join("/");
    }
    return trimmed.split(path.sep).join("/");
  },
}));

let resolveBundlePluginAssetImpl: (input: { pluginId: string; relativePath: string }) => Promise<unknown> =
  async () => ({ ok: false as const, status: 404 as const, message: "not configured" });

mock.module("@/lib/plugins/plugin-manager", () => ({
  resolveBundlePluginAsset: async (input: { pluginId: string; relativePath: string }) =>
    resolveBundlePluginAssetImpl(input),
}));

const { GET } = await import("@/app/api/agents/personas/[slug]/files/route");

beforeEach(async () => {
  await fs.rm(vaultRoot, { recursive: true, force: true });
  await fs.rm(runtimeRoot, { recursive: true, force: true });
  await fs.mkdir(path.dirname(stackAbsolutePath), { recursive: true });
  await fs.mkdir(path.join(runtimeRoot, ".agents/.memory/sample-agent"), { recursive: true });
  await fs.writeFile(
    stackAbsolutePath,
    `${JSON.stringify(
      {
        paths: {
          primary: "instructions.md",
        },
        contextFiles: ["context.md"],
        skills: ["@plugin/acme-tools/skills/release/SKILL.md"],
        skillsets: ["@plugin/acme-tools/skillsets/incident-response.md"],
        extraExtensions: ["@plugin/acme-tools/extensions/git/index.ts"],
      },
      null,
      2
    )}\n`,
    "utf-8"
  );
  await fs.writeFile(path.join(vaultRoot, "instructions.md"), "# Instructions\n", "utf-8");
  await fs.writeFile(path.join(vaultRoot, "context.md"), "# Context\n", "utf-8");

  resolveBundlePluginAssetImpl = async ({ relativePath }) => {
    if (relativePath === "skillsets/incident-response.md") {
      return { ok: false as const, status: 404 as const, message: "missing" };
    }
    return {
      ok: true as const,
      plugin: {} as never,
      relativePath,
      absolutePath: path.join(vaultRoot, relativePath),
      contributionKind: relativePath.includes("extensions")
        ? "extensions"
        : relativePath.includes("skillsets")
          ? "skillsets"
          : "skills",
    };
  };
});

afterAll(async () => {
  await fs.rm(suiteRoot, { recursive: true, force: true });
});

describe("GET /api/agents/personas/[slug]/files", () => {
  test("returns plugin-scoped related files and degrades missing plugin assets to exists=false", async () => {
    const response = await GET(new Request("http://localhost/api/agents/personas/sample-agent/files"), {
      params: Promise.resolve({ slug: "sample-agent" }),
    });

    expect(response.status).toBe(200);
    const data = (await response.json()) as { files: Array<{ path: string; scope: string; exists: boolean }> };

    const skillFile = data.files.find(
      (file) => file.path === "@plugin/acme-tools/skills/release/SKILL.md"
    );
    const extensionFile = data.files.find(
      (file) => file.path === "@plugin/acme-tools/extensions/git/index.ts"
    );
    const missingSkillsetFile = data.files.find(
      (file) => file.path === "@plugin/acme-tools/skillsets/incident-response.md"
    );
    const contextFile = data.files.find((file) => file.path === "context.md");

    expect(skillFile?.scope).toBe("plugin");
    expect(skillFile?.exists).toBe(true);
    expect(extensionFile?.scope).toBe("plugin");
    expect(extensionFile?.exists).toBe(true);
    expect(missingSkillsetFile?.scope).toBe("plugin");
    expect(missingSkillsetFile?.exists).toBe(false);
    expect(contextFile?.scope).toBe("vault");
    expect(contextFile?.exists).toBe(true);
  });
});
