"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Pencil, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/stores/app-store";
import { useTreeStore } from "@/stores/tree-store";
import {
  getAgentRelatedFiles,
  getAgentStack,
  renderMarkdownPreview,
  saveAgentStack,
} from "@/lib/api/agents-client";
import { cn } from "@/lib/utils";
import type {
  AgentDetailPersona,
  AgentRelatedFile,
  SaveAgentPersonaRequest,
} from "@/types/agent-api";
import type { AgentStackPayload, StackCatalogEntry } from "@/types/agent-stack";
import type { AgentLaunchConfig } from "@/types/launchers";
import { CronPicker, cronToHuman } from "./cron-picker";

type DefinitionTabProps = {
  slug: string;
  persona: AgentDetailPersona;
  onSavePersona: (patch: SaveAgentPersonaRequest) => Promise<boolean>;
  onRefresh: () => Promise<void>;
};

function EditableField({
  label,
  value,
  mono,
  onSave,
}: {
  label: string;
  value: string;
  mono?: boolean;
  onSave: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const handleSave = () => {
    if (draft.trim() !== value) onSave(draft.trim());
    setEditing(false);
  };

  return (
    <div
      className="group cursor-pointer rounded-lg bg-muted/30 p-3 transition-colors hover:bg-muted/50"
      onClick={() => {
        if (!editing) {
          setDraft(value);
          setEditing(true);
        }
      }}
    >
      <p className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
        {!editing && (
          <Pencil className="h-2.5 w-2.5 opacity-0 transition-opacity group-hover:opacity-50" />
        )}
      </p>
      {editing ? (
        <div className="mt-1 flex gap-1">
          <input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleSave();
              if (event.key === "Escape") setEditing(false);
            }}
            onBlur={handleSave}
            className={cn(
              "flex-1 rounded border border-border bg-background px-2 py-0.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary/50",
              mono && "font-mono"
            )}
          />
        </div>
      ) : (
        <p className={cn("mt-0.5 text-[13px] font-medium", mono && "font-mono")}>
          {value || "—"}
        </p>
      )}
    </div>
  );
}

function HeartbeatField({
  value,
  onSave,
}: {
  value: string;
  onSave: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div
      className="group cursor-pointer rounded-lg bg-muted/30 p-3 transition-colors hover:bg-muted/50"
      onClick={() => {
        if (!editing) setEditing(true);
      }}
    >
      <p className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
        Heartbeat
        {!editing && (
          <Pencil className="h-2.5 w-2.5 opacity-0 transition-opacity group-hover:opacity-50" />
        )}
      </p>
      {editing ? (
        <div onClick={(event) => event.stopPropagation()}>
          <CronPicker
            value={value}
            onChange={(nextValue) => {
              onSave(nextValue);
              setEditing(false);
            }}
            onDone={() => setEditing(false)}
          />
        </div>
      ) : (
        <div>
          <p className="font-mono text-[13px] font-medium">{value}</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground/60">
            {cronToHuman(value)}
          </p>
        </div>
      )}
    </div>
  );
}

function LauncherConfigCard({
  value,
  onSave,
}: {
  value?: AgentLaunchConfig | null;
  onSave: (value: AgentLaunchConfig | null) => void;
}) {
  const [launcherId, setLauncherId] = useState(value?.launcherId || "");
  const [cwd, setCwd] = useState(value?.cwd || "");
  const [varsJson, setVarsJson] = useState(
    JSON.stringify(value?.vars || {}, null, 2)
  );
  const [error, setError] = useState("");

  useEffect(() => {
    setLauncherId(value?.launcherId || "");
    setCwd(value?.cwd || "");
    setVarsJson(JSON.stringify(value?.vars || {}, null, 2));
    setError("");
  }, [value]);

  const handleSave = () => {
    try {
      const parsedVars = varsJson.trim() ? JSON.parse(varsJson) : {};
      if (parsedVars && typeof parsedVars !== "object") {
        throw new Error("Vars must be a JSON object");
      }
      if (
        !launcherId.trim() &&
        !cwd.trim() &&
        Object.keys(parsedVars || {}).length === 0
      ) {
        onSave(null);
      } else {
        if (!launcherId.trim()) {
          throw new Error("Launcher ID is required when launcher config is set");
        }
        onSave({
          launcherId: launcherId.trim(),
          cwd: cwd.trim() || undefined,
          vars: Object.keys(parsedVars || {}).length > 0 ? parsedVars : undefined,
        });
      }
      setError("");
    } catch {
      setError("Vars must be valid JSON object syntax");
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Launcher
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground/70">
            Set the agent’s CLI launcher and variables. Use vars.stackFile for
            pi-agent-stack.
          </p>
        </div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[10px]"
            onClick={() => onSave(null)}
          >
            Clear
          </Button>
          <Button
            size="sm"
            className="h-7 gap-1 text-[10px]"
            onClick={handleSave}
          >
            <Save className="h-3 w-3" />
            Save
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="mb-1.5 text-[10px] text-muted-foreground">Launcher ID</p>
          <input
            value={launcherId}
            onChange={(event) => setLauncherId(event.target.value)}
            placeholder="claude-code or pi-agent-stack"
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>
        <div>
          <p className="mb-1.5 text-[10px] text-muted-foreground">
            Working Directory
          </p>
          <input
            value={cwd}
            onChange={(event) => setCwd(event.target.value)}
            placeholder="relative to vault"
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-[10px] text-muted-foreground">Vars JSON</p>
        <textarea
          value={varsJson}
          onChange={(event) => setVarsJson(event.target.value)}
          className="min-h-[110px] w-full resize-none rounded border border-border bg-background px-2 py-1.5 font-mono text-[12px] focus:outline-none focus:ring-1 focus:ring-primary/50"
          spellCheck={false}
        />
        {error && <p className="mt-1 text-[10px] text-red-400">{error}</p>}
      </div>
    </div>
  );
}

function OptionChecklist({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: StackCatalogEntry[];
  selected: string[];
  onToggle: (path: string) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div className="max-h-48 space-y-1 overflow-auto rounded-lg border border-border bg-background/60 p-2">
        {options.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">No options found.</p>
        ) : (
          options.map((option) => (
            <label
              key={option.path}
              className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40"
            >
              <input
                type="checkbox"
                checked={selected.includes(option.path)}
                onChange={() => onToggle(option.path)}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="block text-[12px] text-foreground">
                  {option.label}
                </span>
                <span className="block truncate font-mono text-[10px] text-muted-foreground">
                  {option.path}
                </span>
                <span className="block text-[10px] text-muted-foreground/80">
                  {option.source}
                </span>
              </span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}

function togglePath(paths: string[], path: string): string[] {
  return paths.includes(path)
    ? paths.filter((entry) => entry !== path)
    : [...paths, path];
}

function StackConfigCard({
  slug,
  onSaved,
}: {
  slug: string;
  onSaved: () => void | Promise<void>;
}) {
  const [payload, setPayload] = useState<AgentStackPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await getAgentStack(slug);
      setPayload(data);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to load stack");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const updatePaths = (
    key: "primary" | "secondary" | "tertiary",
    value: string
  ) => {
    setPayload((current) =>
      current
        ? {
            ...current,
            stack: {
              ...(current.stack || {}),
              paths: {
                ...(current.stack?.paths || {}),
                [key]: value,
              },
            },
          }
        : current
    );
  };

  const updateList = (
    key: "contextFiles" | "skills" | "skillsets" | "extraExtensions",
    value: string[]
  ) => {
    setPayload((current) =>
      current
        ? {
            ...current,
            stack: {
              ...(current.stack || {}),
              [key]: value,
            },
          }
        : current
    );
  };

  const save = async () => {
    if (!payload?.stack) return;
    setSaving(true);
    setError("");
    try {
      const data = await saveAgentStack(slug, payload.stack);
      setPayload((current) =>
        current
          ? {
              ...current,
              stackPath: data.stackPath || current.stackPath,
              stack: data.stack || current.stack,
            }
          : current
      );
      await onSaved();
      await load();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to save stack");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Stack Configuration
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground/70">
            Edit the actual pi stack file used at launch.
          </p>
          {payload?.stackPath ? (
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">
              {payload.stackPath}
            </p>
          ) : null}
        </div>
        <Button
          size="sm"
          className="h-7 gap-1 text-[10px]"
          onClick={() => void save()}
          disabled={saving || !payload?.stack}
        >
          <Save className="h-3 w-3" />
          {saving ? "Saving..." : "Save stack"}
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading stack...
        </div>
      ) : !payload?.stack ? (
        <p className="text-[12px] text-muted-foreground">
          No stack file is wired for this agent yet.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <p className="mb-1.5 text-[10px] text-muted-foreground">
                Primary context
              </p>
              <input
                value={payload.stack.paths?.primary || ""}
                onChange={(event) => updatePaths("primary", event.target.value)}
                className="w-full rounded border border-border bg-background px-2 py-1.5 font-mono text-[12px] focus:outline-none focus:ring-1 focus:ring-primary/50"
                spellCheck={false}
              />
            </div>
            <div>
              <p className="mb-1.5 text-[10px] text-muted-foreground">
                Secondary context
              </p>
              <input
                value={payload.stack.paths?.secondary || ""}
                onChange={(event) => updatePaths("secondary", event.target.value)}
                className="w-full rounded border border-border bg-background px-2 py-1.5 font-mono text-[12px] focus:outline-none focus:ring-1 focus:ring-primary/50"
                spellCheck={false}
              />
            </div>
            <div>
              <p className="mb-1.5 text-[10px] text-muted-foreground">
                Tertiary context
              </p>
              <input
                value={payload.stack.paths?.tertiary || ""}
                onChange={(event) => updatePaths("tertiary", event.target.value)}
                className="w-full rounded border border-border bg-background px-2 py-1.5 font-mono text-[12px] focus:outline-none focus:ring-1 focus:ring-primary/50"
                spellCheck={false}
              />
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              Extra context files
            </p>
            <textarea
              value={(payload.stack.contextFiles || []).join("\n")}
              onChange={(event) =>
                updateList(
                  "contextFiles",
                  event.target.value
                    .split("\n")
                    .map((entry) => entry.trim())
                    .filter(Boolean)
                )
              }
              className="min-h-[96px] w-full resize-none rounded-lg border border-border bg-background px-3 py-2 font-mono text-[12px] text-foreground"
              spellCheck={false}
              placeholder="One vault-relative path per line"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <OptionChecklist
              label="Extensions"
              options={payload.catalog.extensions}
              selected={payload.stack.extraExtensions || []}
              onToggle={(path) =>
                updateList(
                  "extraExtensions",
                  togglePath(payload.stack?.extraExtensions || [], path)
                )
              }
            />
            <OptionChecklist
              label="Skills"
              options={payload.catalog.skills}
              selected={payload.stack.skills || []}
              onToggle={(path) =>
                updateList("skills", togglePath(payload.stack?.skills || [], path))
              }
            />
            <OptionChecklist
              label="Skillsets"
              options={payload.catalog.skillsets}
              selected={payload.stack.skillsets || []}
              onToggle={(path) =>
                updateList(
                  "skillsets",
                  togglePath(payload.stack?.skillsets || [], path)
                )
              }
            />
          </div>
        </>
      )}

      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
    </div>
  );
}

export function DefinitionTab({
  slug,
  persona,
  onSavePersona,
  onRefresh,
}: DefinitionTabProps) {
  const setSection = useAppStore((state) => state.setSection);
  const selectPage = useTreeStore((state) => state.selectPage);

  const [bodyEdit, setBodyEdit] = useState("");
  const [editingBody, setEditingBody] = useState(false);
  const [savingBody, setSavingBody] = useState(false);
  const [bodyHtml, setBodyHtml] = useState("");
  const [relatedFiles, setRelatedFiles] = useState<AgentRelatedFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [openingPath, setOpeningPath] = useState<string | null>(null);

  const markdownRequestRef = useRef(0);
  const relatedFilesRequestRef = useRef(0);

  useEffect(() => {
    const requestId = ++markdownRequestRef.current;
    void renderMarkdownPreview({ markdown: persona.body })
      .then((html) => {
        if (markdownRequestRef.current !== requestId) return;
        if (html) setBodyHtml(html);
      })
      .catch(() => {
        // Preserve the current silent-failure behavior.
      });
  }, [persona.body]);

  const loadRelatedFiles = useCallback(async () => {
    const requestId = ++relatedFilesRequestRef.current;
    setFilesLoading(true);
    try {
      const files = await getAgentRelatedFiles(slug);
      if (relatedFilesRequestRef.current !== requestId) return;
      setRelatedFiles(Array.isArray(files) ? files : []);
    } catch {
      if (relatedFilesRequestRef.current !== requestId) return;
      setRelatedFiles([]);
    } finally {
      if (relatedFilesRequestRef.current === requestId) {
        setFilesLoading(false);
      }
    }
  }, [slug]);

  useEffect(() => {
    void loadRelatedFiles();
  }, [loadRelatedFiles, persona.launcher]);

  const encodePagePath = (virtualPath: string) =>
    virtualPath
      .split("/")
      .filter(Boolean)
      .map(encodeURIComponent)
      .join("/");

  const openRelatedFile = async (file: AgentRelatedFile) => {
    setOpeningPath(file.path);
    try {
      if (!file.exists && file.creatable) {
        await fetch(`/api/pages/${encodePagePath(file.path)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: "",
            frontmatter: { title: file.label },
          }),
        });
      }
      selectPage(file.path);
      setSection({ type: "page" });
    } finally {
      setOpeningPath(null);
    }
  };

  const savePersonaPatch = useCallback(
    async (patch: SaveAgentPersonaRequest) => {
      try {
        return await onSavePersona(patch);
      } catch {
        return false;
      }
    },
    [onSavePersona]
  );

  const saveBody = async () => {
    if (!bodyEdit.trim() || bodyEdit === persona.body) {
      setEditingBody(false);
      return;
    }

    setSavingBody(true);
    try {
      await savePersonaPatch({ body: bodyEdit });
    } finally {
      setSavingBody(false);
      setEditingBody(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <EditableField
          label="Department"
          value={persona.department}
          onSave={(value) => {
            void savePersonaPatch({ department: value });
          }}
        />
        <EditableField
          label="Type"
          value={persona.type}
          onSave={(value) => {
            void savePersonaPatch({ type: value });
          }}
        />
        <HeartbeatField
          value={persona.heartbeat}
          onSave={(value) => {
            void savePersonaPatch({ heartbeat: value });
          }}
        />
        <EditableField
          label="Workspace"
          value={persona.workspace || "/"}
          mono
          onSave={(value) => {
            void savePersonaPatch({ workspace: value });
          }}
        />
      </div>

      <LauncherConfigCard
        value={persona.launcher}
        onSave={(value) => {
          void savePersonaPatch({ launcher: value });
        }}
      />

      <StackConfigCard
        slug={slug}
        onSaved={async () => {
          await loadRelatedFiles();
          await onRefresh();
        }}
      />

      <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Agent Files
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground/70">
            Open the actual stack, instruction, extension, and runtime context
            files used by this agent.
          </p>
        </div>

        {filesLoading ? (
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading agent files...
          </div>
        ) : relatedFiles.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">
            No linked files detected for this agent yet.
          </p>
        ) : (
          <div className="space-y-2">
            {relatedFiles.map((file) => (
              <div
                key={file.path}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background/60 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-[12px] font-medium text-foreground">
                    {file.label}
                  </p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">
                    {file.path}
                  </p>
                  {file.description ? (
                    <p className="mt-1 text-[10px] text-muted-foreground/80">
                      {file.description}
                    </p>
                  ) : null}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0 text-[10px]"
                  onClick={() => void openRelatedFile(file)}
                  disabled={openingPath === file.path}
                >
                  {openingPath === file.path ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : file.exists ? (
                    "Open"
                  ) : file.creatable ? (
                    "Create & open"
                  ) : (
                    "Open"
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {persona.tags.length > 0 && (
        <div>
          <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            Tags
          </p>
          <div className="flex flex-wrap gap-1">
            {persona.tags.map((tag) => (
              <span
                key={tag}
                className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Persona Instructions
          </p>
          {editingBody ? (
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px]"
                onClick={() => setEditingBody(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-6 gap-1 text-[10px]"
                onClick={() => void saveBody()}
                disabled={savingBody}
              >
                <Save className="h-3 w-3" />
                {savingBody ? "Saving..." : "Save"}
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 text-[10px] opacity-60 hover:opacity-100"
              onClick={() => {
                setBodyEdit(persona.body);
                setEditingBody(true);
              }}
            >
              <Pencil className="h-3 w-3" />
              Edit
            </Button>
          )}
        </div>
        {editingBody ? (
          <textarea
            value={bodyEdit}
            onChange={(event) => setBodyEdit(event.target.value)}
            className="min-h-[400px] w-full resize-none rounded-lg border border-border bg-muted/20 p-4 font-mono text-[12px] leading-relaxed focus:outline-none focus:ring-1 focus:ring-primary/50"
            autoFocus
          />
        ) : (
          <div
            className="cursor-pointer rounded-lg border border-border bg-muted/20 p-4 transition-colors hover:bg-muted/30"
            onClick={() => {
              setBodyEdit(persona.body);
              setEditingBody(true);
            }}
          >
            {bodyHtml ? (
              <div
                className="prose prose-invert prose-sm max-w-none prose-headings:font-semibold prose-h1:text-base prose-h2:text-[13px] prose-h3:text-[12px] prose-p:text-[12px] prose-li:text-[12px] prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:text-[11px] prose-pre:border prose-pre:border-border prose-pre:bg-[#0a0a0a] prose-strong:text-foreground"
                dangerouslySetInnerHTML={{ __html: bodyHtml }}
              />
            ) : (
              <pre className="whitespace-pre-wrap font-sans text-[12px] leading-relaxed">
                {persona.body}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
