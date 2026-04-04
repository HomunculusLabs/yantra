import fs from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { getYantraRoots } from "@/lib/config/yantra-roots";
import { readPersona } from "@/lib/agents/persona-manager";
import { toRuntimeVirtualPath } from "@/lib/storage/path-utils";

type RouteParams = { params: Promise<{ slug: string }> };

type AgentRelatedFile = {
  label: string;
  path: string;
  scope: "vault" | "runtime";
  kind:
    | "persona"
    | "stack"
    | "context"
    | "instruction"
    | "extension"
    | "skill";
  description?: string;
  exists: boolean;
  creatable?: boolean;
};

function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function normalizeVaultRelativePath(input: unknown, vaultRoot: string): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const withoutDot = trimmed.replace(/^\.\//, "");
  if (path.isAbsolute(withoutDot)) {
    const resolved = path.resolve(withoutDot);
    const normalizedVaultRoot = path.resolve(vaultRoot);
    if (
      resolved !== normalizedVaultRoot &&
      !resolved.startsWith(`${normalizedVaultRoot}${path.sep}`)
    ) {
      return null;
    }
    return toPosix(path.relative(normalizedVaultRoot, resolved));
  }

  return withoutDot.split(path.sep).join("/");
}

async function exists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

export async function GET(_req: Request, { params }: RouteParams) {
  try {
    const { slug } = await params;
    const persona = await readPersona(slug);
    if (!persona) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const roots = getYantraRoots();
    const files = new Map<string, AgentRelatedFile>();

    const addFile = async (file: Omit<AgentRelatedFile, "exists"> & { exists?: boolean }) => {
      if (!file.path || files.has(file.path)) return;
      let resolvedExists = file.exists;
      if (resolvedExists === undefined) {
        if (file.scope === "vault") {
          resolvedExists = await exists(path.join(roots.vaultRoot, file.path));
        } else {
          const runtimeRelative = file.path.replace(/^@runtime\/?/, "");
          resolvedExists = await exists(path.join(roots.runtimeRoot, runtimeRelative));
        }
      }

      files.set(file.path, {
        ...file,
        exists: Boolean(resolvedExists),
      });
    };

    await addFile({
      label: "Runtime persona",
      path: toRuntimeVirtualPath(`.agents/${slug}/persona.md`),
      scope: "runtime",
      kind: "persona",
      description: "Yantra runtime persona file",
    });

    for (const memoryFile of [
      {
        label: "Agent context",
        file: `@runtime/.agents/.memory/${slug}/context.md`,
        description: "Runtime memory and carried-forward context",
      },
      {
        label: "Agent decisions",
        file: `@runtime/.agents/.memory/${slug}/decisions.md`,
        description: "Decision log for this agent",
      },
      {
        label: "Agent learnings",
        file: `@runtime/.agents/.memory/${slug}/learnings.md`,
        description: "Accumulated learnings for this agent",
      },
    ]) {
      await addFile({
        label: memoryFile.label,
        path: memoryFile.file,
        scope: "runtime",
        kind: "context",
        description: memoryFile.description,
        creatable: true,
      });
    }

    const stackPath = normalizeVaultRelativePath(
      persona.launcher?.vars?.stackFile,
      roots.vaultRoot
    );

    if (stackPath) {
      await addFile({
        label: "Stack config",
        path: stackPath,
        scope: "vault",
        kind: "stack",
        description: "Launcher stack used by pi-agent-stack",
      });

      const stackAbsPath = path.join(roots.vaultRoot, stackPath);
      if (await exists(stackAbsPath)) {
        const raw = await fs.readFile(stackAbsPath, "utf-8");
        const stack = JSON.parse(raw) as Record<string, unknown>;

        const stackPaths = (stack.paths || {}) as Record<string, unknown>;
        const mappedPaths: Array<[keyof typeof stackPaths, string]> = [
          ["primary", "Primary instructions"],
          ["secondary", "Secondary instructions"],
          ["tertiary", "Tertiary instructions"],
        ];

        for (const [key, label] of mappedPaths) {
          const normalized = normalizeVaultRelativePath(stackPaths[key], roots.vaultRoot);
          if (!normalized) continue;
          await addFile({
            label,
            path: normalized,
            scope: "vault",
            kind: "instruction",
          });
        }

        const addPathArray = async (
          values: unknown,
          kind: AgentRelatedFile["kind"],
          prefix: string,
          description?: string
        ) => {
          if (!Array.isArray(values)) return;
          let index = 0;
          for (const value of values) {
            const normalized = normalizeVaultRelativePath(value, roots.vaultRoot);
            if (!normalized) continue;
            index += 1;
            await addFile({
              label: `${prefix} ${index}`,
              path: normalized,
              scope: "vault",
              kind,
              description,
            });
          }
        };

        await addPathArray(
          stack.extraExtensions,
          "extension",
          "Extension",
          "Extra runtime extension loaded by the stack"
        );
        await addPathArray(
          stack.extensions,
          "extension",
          "Extension",
          "Configured extension file"
        );
        await addPathArray(
          stack.skills,
          "skill",
          "Skill",
          "Configured skill file"
        );
        await addPathArray(
          stack.skillsets,
          "skill",
          "Skillset",
          "Configured skillset file"
        );
        await addPathArray(
          stack.contextFiles,
          "context",
          "Context file",
          "Injected context file"
        );
      }
    }

    return NextResponse.json({ files: Array.from(files.values()) });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to resolve agent files";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
