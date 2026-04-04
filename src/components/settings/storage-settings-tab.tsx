"use client";

import { useEffect, useMemo } from "react";
import {
  Blocks,
  Bot,
  Check,
  ChevronDown,
  FolderTree,
  Loader2,
  ListTodo,
  Plug,
  Puzzle,
  SquareCheckBig,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useTreeStore } from "@/stores/tree-store";
import type { TreeNode } from "@/types";
import type { RootsConfig, StorageRouteConfig, StorageRouteKey } from "@/types/settings";

const ROUTE_META: Record<
  StorageRouteKey,
  {
    label: string;
    description: string;
    icon: typeof Bot;
  }
> = {
  agents: {
    label: "Agent folder",
    description: "Home for agent definitions, personas, prompts, and shared scaffolding.",
    icon: Bot,
  },
  skills: {
    label: "Skills folder",
    description: "Skill docs and skill packages that should be indexed for agent building.",
    icon: Blocks,
  },
  extensions: {
    label: "Extensions folder",
    description: "Runtime extensions, wrappers, and helper code loaded into agent stacks.",
    icon: Puzzle,
  },
  mcp: {
    label: "MCP folder",
    description: "MCP server notes, configs, and supporting files for tool integrations.",
    icon: Plug,
  },
  todo: {
    label: "TODO folder",
    description: "Backlog notes, next actions, and planning pages for follow-up work.",
    icon: ListTodo,
  },
  tasks: {
    label: "Tasks folder",
    description: "Structured task files or task queues that agents should be able to index.",
    icon: SquareCheckBig,
  },
};

function clearIndexedPreview(value: StorageRouteConfig): StorageRouteConfig {
  return {
    ...value,
    resolvedPath: undefined,
    exists: undefined,
    indexedFileCount: undefined,
    sampleFiles: [],
  };
}

type FolderOption = {
  path: string;
  label: string;
  depth: number;
};

function collectFolderOptions(nodes: TreeNode[], depth = 0): FolderOption[] {
  const folders: FolderOption[] = [];

  for (const node of nodes) {
    if (node.type !== "directory") continue;
    folders.push({
      path: node.path,
      label: node.frontmatter?.title || node.name,
      depth,
    });
    if (node.children?.length) {
      folders.push(...collectFolderOptions(node.children, depth + 1));
    }
  }

  return folders;
}

export function StorageSettingsTab({
  roots,
  loading,
  onChange,
}: {
  roots: RootsConfig | null;
  loading: boolean;
  onChange: (next: RootsConfig) => void;
}) {
  const treeNodes = useTreeStore((state) => state.nodes);
  const treeLoading = useTreeStore((state) => state.loading);
  const loadTree = useTreeStore((state) => state.loadTree);

  const clearAllRoutePreviews = (storageRoutes: RootsConfig["storageRoutes"]) =>
    ({
      agents: clearIndexedPreview(storageRoutes.agents),
      skills: clearIndexedPreview(storageRoutes.skills),
      extensions: clearIndexedPreview(storageRoutes.extensions),
      mcp: clearIndexedPreview(storageRoutes.mcp),
      todo: clearIndexedPreview(storageRoutes.todo),
      tasks: clearIndexedPreview(storageRoutes.tasks),
    }) satisfies RootsConfig["storageRoutes"];

  useEffect(() => {
    if (treeNodes.length === 0 && !treeLoading) {
      void loadTree();
    }
  }, [loadTree, treeLoading, treeNodes.length]);

  const folderOptions = useMemo(
    () => [{ path: ".", label: "Vault root", depth: 0 }, ...collectFolderOptions(treeNodes)],
    [treeNodes]
  );

  const folderLabelByPath = useMemo(
    () =>
      Object.fromEntries(
        folderOptions.map((option) => [
          option.path,
          option.path === "." ? option.label : `${option.label} · ${option.path}`,
        ])
      ) as Record<string, string>,
    [folderOptions]
  );

  if (loading || !roots) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading storage settings...
      </div>
    );
  }

  const updateRoute = (
    routeKey: StorageRouteKey,
    patch: Partial<RootsConfig["storageRoutes"][StorageRouteKey]>
  ) => {
    onChange({
      ...roots,
      storageRoutes: {
        ...roots.storageRoutes,
        [routeKey]: clearIndexedPreview({
          ...roots.storageRoutes[routeKey],
          ...patch,
        }),
      },
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-[14px] font-semibold">Vault and runtime roots</h3>
        <p className="text-xs text-muted-foreground">
          Yantra reads your PKMS content from the vault root and stores runtime state under a
          separate runtime root.
        </p>
      </div>

      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <label className="block space-y-1.5">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Vault root
          </span>
          <input
            value={roots.vaultRoot}
            onChange={(event) =>
              onChange({
                ...roots,
                vaultRoot: event.target.value,
                storageRoutes: clearAllRoutePreviews(roots.storageRoutes),
              })
            }
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground"
            spellCheck={false}
          />
          <p className="text-[11px] text-muted-foreground">
            Current status: {roots.checks?.vaultExists ? "found" : "missing"}
          </p>
        </label>

        <label className="block space-y-1.5">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Runtime root
          </span>
          <input
            value={roots.runtimeRoot}
            onChange={(event) =>
              onChange({
                ...roots,
                runtimeRoot: event.target.value,
              })
            }
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground"
            spellCheck={false}
          />
          <p className="text-[11px] text-muted-foreground">
            Current status: {roots.checks?.runtimeExists ? "found" : "will be created"}
          </p>
        </label>
      </div>

      <div className="space-y-2">
        <div>
          <h3 className="text-[14px] font-semibold">Agent-building folders</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            These routes are resolved inside the current vault root. Turn recursive indexing on
            when the folder contains nested packages or grouped subfolders.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {(Object.keys(ROUTE_META) as StorageRouteKey[]).map((routeKey) => {
            const route = roots.storageRoutes[routeKey];
            const meta = ROUTE_META[routeKey];
            const Icon = meta.icon;

            return (
              <div
                key={routeKey}
                className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2">
                    <span className="rounded-md border border-border bg-background p-2 text-muted-foreground">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-[13px] font-medium text-foreground">{meta.label}</p>
                      <p className="text-[11px] text-muted-foreground">{meta.description}</p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={route.recursive ? "default" : "outline"}
                    onClick={() =>
                      updateRoute(routeKey, {
                        recursive: !route.recursive,
                      })
                    }
                  >
                    <FolderTree data-icon="inline-start" />
                    {route.recursive ? "Recursive on" : "Recursive off"}
                  </Button>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className={cn(
                        buttonVariants({ variant: "outline", size: "lg" }),
                        "w-full justify-between px-3 text-[13px] font-normal"
                      )}
                    >
                      <span className="truncate">
                        {folderLabelByPath[route.path] || route.path}
                      </span>
                      <ChevronDown data-icon="inline-end" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="max-h-80">
                      <DropdownMenuGroup>
                        <DropdownMenuLabel>Select folder from knowledge base</DropdownMenuLabel>
                        {treeLoading && folderOptions.length <= 1 ? (
                          <DropdownMenuItem disabled>Loading folders...</DropdownMenuItem>
                        ) : (
                          <>
                            {folderOptions.map((option) => (
                            <DropdownMenuItem
                              key={option.path}
                              onClick={() => updateRoute(routeKey, { path: option.path })}
                            >
                              <Check
                                className={cn(
                                  option.path === route.path ? "opacity-100" : "opacity-0"
                                )}
                              />
                              <span
                                className="truncate"
                                style={{ paddingLeft: `${option.depth * 12}px` }}
                              >
                                {option.path === "."
                                  ? option.label
                                  : `${option.label} · ${option.path}`}
                              </span>
                            </DropdownMenuItem>
                            ))}
                          </>
                        )}
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5",
                      route.exists === true
                        ? "bg-emerald-500/10 text-emerald-500"
                        : route.exists === false
                          ? "bg-amber-500/10 text-amber-500"
                          : "bg-muted text-muted-foreground"
                    )}
                  >
                    {route.exists === true
                      ? "Folder found"
                      : route.exists === false
                        ? "Folder missing"
                        : "Unsaved changes"}
                  </span>
                  <span>
                    Indexed files:{" "}
                    <span className="font-medium text-foreground">
                      {route.indexedFileCount ?? "—"}
                    </span>
                  </span>
                </div>

                <div className="space-y-1">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Resolved path
                  </p>
                  <p className="truncate rounded-md border border-border bg-background px-2.5 py-2 font-mono text-[11px] text-muted-foreground">
                    {route.resolvedPath || "Preview refreshes after save"}
                  </p>
                </div>

              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
        <p className="text-[12px] font-medium text-foreground">Restart required after save</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          The app server and daemon cache these roots at startup. Save the paths here, then
          restart Yantra so runtime summaries and future folder-backed indexes pick up the new
          locations.
        </p>
        {roots.configPath ? (
          <p className="mt-2 text-[11px] font-mono text-muted-foreground">
            Config file: {roots.configPath}
          </p>
        ) : null}
      </div>
    </div>
  );
}
