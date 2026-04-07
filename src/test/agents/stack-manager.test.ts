import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";

const suiteRoot = await fs.mkdtemp(path.join(os.tmpdir(), "yantra-stack-manager-"));
const vaultRoot = path.join(suiteRoot, "vault");
const runtimeRoot = path.join(suiteRoot, "runtime");
const configuredExtensionsRoot = path.join(vaultRoot, ".agents/extensions");
const configuredSkillsRoot = path.join(vaultRoot, ".agents/skills");
const stackFilePath = path.join(vaultRoot, ".agents/stacks/sample.json");

mock.module("@/lib/config/yantra-roots", () => ({
  getYantraRoots: () => ({
    vaultRoot,
    runtimeRoot,
  }),
  getYantraStorageRoutes: () => ({
    extensions: { path: ".agents/extensions", recursive: true },
    skills: { path: ".agents/skills", recursive: true },
  }),
  resolveConfiguredVaultPath: (relativePath: string, root: string) => path.resolve(root, relativePath),
}));

let bundlePlugins: Array<{
  manifest: {
    id: string;
    name: string;
    version: string;
    apiVersion: 1;
    kind: "bundle";
    requestedCapabilities: { required: string[]; optional: string[] };
    bundle: {
      extensions?: string[];
      skills?: string[];
      skillsets?: string[];
    };
  };
  status: "enabled";
  issues: [];
}> = [];
mock.module("@/lib/plugins/plugin-manager", () => ({
  listEnabledBundlePlugins: async () => bundlePlugins,
}));

mock.module("@/lib/agents/persona-manager", () => ({
  readPersona: async () => ({
    slug: "sample-agent",
    launcher: {
      vars: {
        stackFile: ".agents/stacks/sample.json",
      },
    },
  }),
}));

const { listAgentStackCatalog, writeAgentStack } = await import("@/lib/agents/stack-manager");

beforeEach(async () => {
  bundlePlugins = [];
  await fs.rm(vaultRoot, { recursive: true, force: true });
  await fs.rm(runtimeRoot, { recursive: true, force: true });
  await fs.mkdir(configuredExtensionsRoot, { recursive: true });
  await fs.mkdir(configuredSkillsRoot, { recursive: true });
  await fs.mkdir(path.dirname(stackFilePath), { recursive: true });

  await fs.mkdir(path.join(configuredExtensionsRoot, "core-ext"), { recursive: true });
  await fs.writeFile(path.join(configuredExtensionsRoot, "core-ext/index.ts"), "export default {};\n", "utf-8");
  await fs.mkdir(path.join(configuredSkillsRoot, "release-skill"), { recursive: true });
  await fs.writeFile(path.join(configuredSkillsRoot, "release-skill/SKILL.md"), "# Skill\n", "utf-8");
  await fs.mkdir(path.join(vaultRoot, "60-69 Agents/62 - Skills/62.40 - Skillsets"), { recursive: true });
  await fs.writeFile(
    path.join(vaultRoot, "60-69 Agents/62 - Skills/62.40 - Skillsets/ops.md"),
    "# Ops\n",
    "utf-8"
  );

  await fs.writeFile(
    stackFilePath,
    `${JSON.stringify(
      {
        paths: { primary: "instructions.md" },
        contextFiles: ["context.md"],
        skills: [],
        skillsets: [],
        extraExtensions: [],
      },
      null,
      2
    )}\n`,
    "utf-8"
  );
});

afterAll(async () => {
  await fs.rm(suiteRoot, { recursive: true, force: true });
});

describe("stack-manager plugin phase 3", () => {
  test("merges enabled bundle plugin contributions into the stack catalog", async () => {
    bundlePlugins = [
      {
        manifest: {
          id: "acme-tools",
          name: "Acme Tools",
          version: "1.0.0",
          apiVersion: 1,
          kind: "bundle",
          requestedCapabilities: { required: [], optional: [] },
          bundle: {
            extensions: ["extensions/git/index.ts"],
            skills: ["skills/release/SKILL.md"],
            skillsets: ["skillsets/incident-response.md"],
          },
        },
        status: "enabled",
        issues: [],
      },
    ];

    const catalog = await listAgentStackCatalog();
    expect(catalog.extensions.some((entry) => entry.path === "./.agents/extensions/core-ext/index.ts")).toBe(true);
    expect(
      catalog.extensions.some(
        (entry) =>
          entry.label === "Acme Tools / git" &&
          entry.path === "@plugin/acme-tools/extensions/git/index.ts" &&
          entry.source === "plugin:acme-tools"
      )
    ).toBe(true);
    expect(
      catalog.skills.some(
        (entry) =>
          entry.label === "Acme Tools / release" &&
          entry.path === "@plugin/acme-tools/skills/release/SKILL.md" &&
          entry.source === "plugin:acme-tools"
      )
    ).toBe(true);
    expect(
      catalog.skillsets.some(
        (entry) =>
          entry.label === "Acme Tools / incident-response" &&
          entry.path === "@plugin/acme-tools/skillsets/incident-response.md" &&
          entry.source === "plugin:acme-tools"
      )
    ).toBe(true);
  });

  test("preserves plugin contribution references in supported stack fields only", async () => {
    const result = await writeAgentStack("sample-agent", {
      contextFiles: ["context.md", "@plugin/acme-tools/skills/release/SKILL.md"],
      skills: ["@plugin/acme-tools/skills/release/SKILL.md", "notes/local-skill.md"],
      skillsets: ["@plugin/acme-tools/skillsets/incident-response.md"],
      extraExtensions: ["@plugin/acme-tools/extensions/git/index.ts", "tools/ext/index.ts"],
    });

    expect(result.stack.contextFiles).toEqual(["context.md"]);
    expect(result.stack.skills).toEqual([
      "@plugin/acme-tools/skills/release/SKILL.md",
      "notes/local-skill.md",
    ]);
    expect(result.stack.skillsets).toEqual([
      "@plugin/acme-tools/skillsets/incident-response.md",
    ]);
    expect(result.stack.extraExtensions).toEqual([
      "@plugin/acme-tools/extensions/git/index.ts",
      "./tools/ext/index.ts",
    ]);

    const persisted = JSON.parse(await fs.readFile(stackFilePath, "utf-8")) as {
      contextFiles: string[];
      skills: string[];
      skillsets: string[];
      extraExtensions: string[];
    };
    expect(persisted.contextFiles).toEqual(["context.md"]);
    expect(persisted.skills).toEqual(result.stack.skills);
    expect(persisted.skillsets).toEqual(result.stack.skillsets);
    expect(persisted.extraExtensions).toEqual(result.stack.extraExtensions);
  });
});
