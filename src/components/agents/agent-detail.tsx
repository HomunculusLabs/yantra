"use client";

import { useEffect, useState, useCallback } from "react";
import {
  ArrowLeft,
  Play,
  Pause,
  FileText,
  Briefcase,
  Clock,
  Zap,
  Check,
  CheckCircle,
  Copy,
  XCircle,
  RefreshCw,
  Plus,
  Send,
  Loader2,
  MessageSquare,
  Save,
  Trash2,
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAppStore } from "@/stores/app-store";
import { useTreeStore } from "@/stores/tree-store";
import { WebTerminal } from "@/components/terminal/web-terminal";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { cn } from "@/lib/utils";
import type { AgentStackPayload, StackCatalogEntry } from "@/types/agent-stack";

type TabId = "definition" | "jobs" | "sessions";

interface AgentLauncherConfig {
  launcherId: string;
  cwd?: string;
  vars?: Record<string, string>;
}

interface AgentPersona {
  name: string;
  slug: string;
  emoji: string;
  type: string;
  department: string;
  role: string;
  active: boolean;
  heartbeat: string;
  body: string;
  workspace: string;
  tags: string[];
  focus: string[];
  launcher?: AgentLauncherConfig | null;
  heartbeatsUsed?: number;
  lastHeartbeat?: string;
  nextHeartbeat?: string;
}

interface AgentRelatedFile {
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
}

interface HeartbeatRecord {
  agentSlug: string;
  timestamp: string;
  duration: number;
  status: "completed" | "failed";
  summary: string;
}

const TABS: { id: TabId; label: string; icon: typeof FileText }[] = [
  { id: "definition", label: "Definition", icon: FileText },
  { id: "jobs", label: "Jobs", icon: Briefcase },
  { id: "sessions", label: "Sessions", icon: Clock },
];

/* ─── Cron Presets ─── */
const CRON_PRESETS = [
  { label: "Every hour", cron: "0 * * * *" },
  { label: "Every 2 hours", cron: "0 */2 * * *" },
  { label: "Every 4 hours", cron: "0 */4 * * *" },
  { label: "Every 6 hours", cron: "0 */6 * * *" },
  { label: "Every day at 9am", cron: "0 9 * * *" },
  { label: "Every day at noon", cron: "0 12 * * *" },
  { label: "Every day at 6pm", cron: "0 18 * * *" },
  { label: "Weekdays at 9am", cron: "0 9 * * 1-5" },
  { label: "Weekdays at 8am & 2pm", cron: "0 8,14 * * 1-5" },
  { label: "Monday at 9am", cron: "0 9 * * 1" },
  { label: "Mon, Wed, Fri at 9am", cron: "0 9 * * 1,3,5" },
  { label: "Every 15 minutes", cron: "*/15 * * * *" },
  { label: "Every 30 minutes", cron: "*/30 * * * *" },
  { label: "Twice daily (9am & 5pm)", cron: "0 9,17 * * *" },
  { label: "Weekly on Sunday", cron: "0 9 * * 0" },
];

function cronToHuman(cron: string): string {
  const preset = CRON_PRESETS.find((p) => p.cron === cron);
  if (preset) return preset.label;
  return cron;
}

function CronPicker({
  value,
  onChange,
  onDone,
  compact,
}: {
  value: string;
  onChange: (cron: string) => void;
  onDone?: () => void;
  compact?: boolean;
}) {
  const [showCustom, setShowCustom] = useState(false);
  const [custom, setCustom] = useState(value);
  const isPreset = CRON_PRESETS.some((p) => p.cron === value);

  return (
    <div className={cn("space-y-1", compact ? "" : "space-y-1.5")}>
      <div className="flex flex-wrap gap-1">
        {CRON_PRESETS.map((p) => (
          <button
            key={p.cron}
            onClick={() => { onChange(p.cron); setShowCustom(false); onDone?.(); }}
            className={cn(
              "px-2 py-0.5 rounded text-[10px] transition-colors border",
              value === p.cron
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-muted/30 text-muted-foreground border-border hover:bg-muted/60 hover:text-foreground"
            )}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => { setShowCustom(!showCustom); setCustom(value); }}
          className={cn(
            "px-2 py-0.5 rounded text-[10px] transition-colors border",
            showCustom || (!isPreset && value)
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-muted/30 text-muted-foreground border-border hover:bg-muted/60 hover:text-foreground"
          )}
        >
          Custom
        </button>
      </div>
      {(showCustom || (!isPreset && value)) && (
        <div className="flex items-center gap-1">
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { onChange(custom); onDone?.(); }
              if (e.key === "Escape") { setShowCustom(false); onDone?.(); }
            }}
            className="flex-1 bg-background border border-border rounded px-2 py-0.5 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
            placeholder="e.g. 0 9 * * 1-5"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={() => { onChange(custom); onDone?.(); }}
          >
            <Save className="h-3 w-3" />
          </Button>
        </div>
      )}
      {value && (
        <p className="text-[10px] text-muted-foreground/60 font-mono">
          {value} {isPreset ? "" : `— ${value}`}
        </p>
      )}
    </div>
  );
}

/* ─── Editable Field ─── */
function EditableField({
  label,
  value,
  mono,
  onSave,
}: {
  label: string;
  value: string;
  mono?: boolean;
  onSave: (val: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const handleSave = () => {
    if (draft.trim() !== value) onSave(draft.trim());
    setEditing(false);
  };

  return (
    <div
      className="bg-muted/30 rounded-lg p-3 group cursor-pointer hover:bg-muted/50 transition-colors"
      onClick={() => { if (!editing) { setDraft(value); setEditing(true); } }}
    >
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center justify-between">
        {label}
        {!editing && <Pencil className="h-2.5 w-2.5 opacity-0 group-hover:opacity-50 transition-opacity" />}
      </p>
      {editing ? (
        <div className="flex gap-1 mt-1">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setEditing(false); }}
            onBlur={handleSave}
            className={cn(
              "flex-1 bg-background border border-border rounded px-2 py-0.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary/50",
              mono && "font-mono"
            )}
          />
        </div>
      ) : (
        <p className={cn("text-[13px] font-medium mt-0.5", mono && "font-mono")}>
          {value || "—"}
        </p>
      )}
    </div>
  );
}

/* ─── Heartbeat Field (uses CronPicker) ─── */
function HeartbeatField({
  value,
  onSave,
}: {
  value: string;
  onSave: (val: string) => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div
      className="bg-muted/30 rounded-lg p-3 group cursor-pointer hover:bg-muted/50 transition-colors"
      onClick={() => { if (!editing) setEditing(true); }}
    >
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center justify-between mb-1">
        Heartbeat
        {!editing && <Pencil className="h-2.5 w-2.5 opacity-0 group-hover:opacity-50 transition-opacity" />}
      </p>
      {editing ? (
        <div onClick={(e) => e.stopPropagation()}>
          <CronPicker
            value={value}
            onChange={(v) => { onSave(v); setEditing(false); }}
            onDone={() => setEditing(false)}
          />
        </div>
      ) : (
        <div>
          <p className="text-[13px] font-medium font-mono">{value}</p>
          <p className="text-[10px] text-muted-foreground/60 mt-0.5">{cronToHuman(value)}</p>
        </div>
      )}
    </div>
  );
}

function LauncherConfigCard({
  value,
  onSave,
}: {
  value?: AgentLauncherConfig | null;
  onSave: (value: AgentLauncherConfig | null) => void;
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
      if (!launcherId.trim() && !cwd.trim() && Object.keys(parsedVars || {}).length === 0) {
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
    <div className="bg-muted/20 border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Launcher
          </p>
          <p className="text-[11px] text-muted-foreground/70 mt-1">
            Set the agent’s CLI launcher and variables. Use vars.stackFile for pi-agent-stack.
          </p>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" className="h-7 text-[10px]" onClick={() => onSave(null)}>
            Clear
          </Button>
          <Button size="sm" className="h-7 text-[10px] gap-1" onClick={handleSave}>
            <Save className="h-3 w-3" />
            Save
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[10px] text-muted-foreground mb-1.5">Launcher ID</p>
          <input
            value={launcherId}
            onChange={(e) => setLauncherId(e.target.value)}
            placeholder="claude-code or pi-agent-stack"
            className="w-full bg-background border border-border rounded px-2 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground mb-1.5">Working Directory</p>
          <input
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            placeholder="relative to vault"
            className="w-full bg-background border border-border rounded px-2 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>
      </div>

      <div>
        <p className="text-[10px] text-muted-foreground mb-1.5">Vars JSON</p>
        <textarea
          value={varsJson}
          onChange={(e) => setVarsJson(e.target.value)}
          className="w-full bg-background border border-border rounded px-2 py-1.5 text-[12px] font-mono focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none min-h-[110px]"
          spellCheck={false}
        />
        {error && <p className="text-[10px] text-red-400 mt-1">{error}</p>}
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
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
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
                <span className="block truncate text-[10px] font-mono text-muted-foreground">
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
      const res = await fetch(`/api/agents/personas/${slug}/stack`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to load stack");
      }
      setPayload(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load stack");
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
      const res = await fetch(`/api/agents/personas/${slug}/stack`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stack: payload.stack }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to save stack");
      }
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save stack");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-muted/20 border border-border rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Stack Configuration
          </p>
          <p className="text-[11px] text-muted-foreground/70 mt-1">
            Edit the actual pi stack file used at launch.
          </p>
          {payload?.stackPath ? (
            <p className="mt-1 text-[10px] font-mono text-muted-foreground">
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
              <p className="mb-1.5 text-[10px] text-muted-foreground">Primary context</p>
              <input
                value={payload.stack.paths?.primary || ""}
                onChange={(e) => updatePaths("primary", e.target.value)}
                className="w-full bg-background border border-border rounded px-2 py-1.5 text-[12px] font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
                spellCheck={false}
              />
            </div>
            <div>
              <p className="mb-1.5 text-[10px] text-muted-foreground">Secondary context</p>
              <input
                value={payload.stack.paths?.secondary || ""}
                onChange={(e) => updatePaths("secondary", e.target.value)}
                className="w-full bg-background border border-border rounded px-2 py-1.5 text-[12px] font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
                spellCheck={false}
              />
            </div>
            <div>
              <p className="mb-1.5 text-[10px] text-muted-foreground">Tertiary context</p>
              <input
                value={payload.stack.paths?.tertiary || ""}
                onChange={(e) => updatePaths("tertiary", e.target.value)}
                className="w-full bg-background border border-border rounded px-2 py-1.5 text-[12px] font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
                spellCheck={false}
              />
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[10px] text-muted-foreground uppercase tracking-wider">
              Extra context files
            </p>
            <textarea
              value={(payload.stack.contextFiles || []).join("\n")}
              onChange={(e) =>
                updateList(
                  "contextFiles",
                  e.target.value
                    .split("\n")
                    .map((entry) => entry.trim())
                    .filter(Boolean)
                )
              }
              className="min-h-[96px] w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[12px] font-mono text-foreground"
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

/* ─── Definition Tab ─── */
function DefinitionTab({
  persona,
  slug,
  onRefresh,
}: {
  persona: AgentPersona;
  slug: string;
  onRefresh: () => void;
}) {
  const setSection = useAppStore((s) => s.setSection);
  const selectPage = useTreeStore((s) => s.selectPage);
  const [bodyEdit, setBodyEdit] = useState("");
  const [editingBody, setEditingBody] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bodyHtml, setBodyHtml] = useState("");
  const [relatedFiles, setRelatedFiles] = useState<AgentRelatedFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [openingPath, setOpeningPath] = useState<string | null>(null);

  // Render markdown to HTML for display
  useEffect(() => {
    fetch("/api/ai/render-md", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown: persona.body }),
    })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data?.html) setBodyHtml(data.html); })
      .catch(() => {});
  }, [persona.body]);

  const loadRelatedFiles = useCallback(async () => {
    setFilesLoading(true);
    try {
      const r = await fetch(`/api/agents/personas/${slug}/files`);
      const data = r.ok ? await r.json() : { files: [] };
      setRelatedFiles(Array.isArray(data.files) ? data.files : []);
    } catch {
      setRelatedFiles([]);
    } finally {
      setFilesLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await loadRelatedFiles();
      if (cancelled) return;
    })();

    return () => {
      cancelled = true;
    };
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

  const saveField = async (field: string, value: string) => {
    await fetch(`/api/agents/personas/${slug}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    onRefresh();
  };

  const saveLauncher = async (launcher: AgentLauncherConfig | null) => {
    await fetch(`/api/agents/personas/${slug}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ launcher }),
    });
    onRefresh();
  };

  const saveBody = async () => {
    if (!bodyEdit.trim() || bodyEdit === persona.body) { setEditingBody(false); return; }
    setSaving(true);
    await fetch(`/api/agents/personas/${slug}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: bodyEdit }),
    });
    setSaving(false);
    setEditingBody(false);
    onRefresh();
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <EditableField
          label="Department"
          value={persona.department}
          onSave={(v) => saveField("department", v)}
        />
        <EditableField
          label="Type"
          value={persona.type}
          onSave={(v) => saveField("type", v)}
        />
        <HeartbeatField
          value={persona.heartbeat}
          onSave={(v) => saveField("heartbeat", v)}
        />
        <EditableField
          label="Workspace"
          value={persona.workspace || "/"}
          mono
          onSave={(v) => saveField("workspace", v)}
        />
      </div>

      <LauncherConfigCard value={persona.launcher} onSave={saveLauncher} />

      <StackConfigCard
        slug={slug}
        onSaved={async () => {
          await loadRelatedFiles();
          onRefresh();
        }}
      />

      <div className="bg-muted/20 border border-border rounded-lg p-4 space-y-3">
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Agent Files
          </p>
          <p className="text-[11px] text-muted-foreground/70 mt-1">
            Open the actual stack, instruction, extension, and runtime context files used by this agent.
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
                  <p className="truncate text-[11px] font-mono text-muted-foreground">
                    {file.path}
                  </p>
                  {file.description ? (
                    <p className="text-[10px] text-muted-foreground/80 mt-1">
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
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">
            Tags
          </p>
          <div className="flex gap-1 flex-wrap">
            {persona.tags.map((tag) => (
              <span
                key={tag}
                className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
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
                className="h-6 text-[10px] gap-1"
                onClick={saveBody}
                disabled={saving}
              >
                <Save className="h-3 w-3" />
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[10px] gap-1 opacity-60 hover:opacity-100"
              onClick={() => { setBodyEdit(persona.body); setEditingBody(true); }}
            >
              <Pencil className="h-3 w-3" />
              Edit
            </Button>
          )}
        </div>
        {editingBody ? (
          <textarea
            value={bodyEdit}
            onChange={(e) => setBodyEdit(e.target.value)}
            className="w-full bg-muted/20 border border-border rounded-lg p-4 text-[12px] font-mono leading-relaxed resize-none focus:outline-none focus:ring-1 focus:ring-primary/50 min-h-[400px]"
            autoFocus
          />
        ) : (
          <div
            className="bg-muted/20 border border-border rounded-lg p-4 cursor-pointer hover:bg-muted/30 transition-colors"
            onClick={() => { setBodyEdit(persona.body); setEditingBody(true); }}
          >
            {bodyHtml ? (
              <div
                className="prose prose-invert prose-sm max-w-none prose-headings:font-semibold prose-h1:text-base prose-h2:text-[13px] prose-h3:text-[12px] prose-p:text-[12px] prose-li:text-[12px] prose-code:text-[11px] prose-code:bg-muted prose-code:px-1 prose-code:rounded prose-pre:bg-[#0a0a0a] prose-pre:border prose-pre:border-border prose-strong:text-foreground"
                dangerouslySetInnerHTML={{ __html: bodyHtml }}
              />
            ) : (
              <pre className="text-[12px] whitespace-pre-wrap font-sans leading-relaxed">
                {persona.body}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Jobs Tab ─── */
interface AgentJob {
  id: string;
  name: string;
  enabled: boolean;
  schedule: string;
  prompt: string;
  timeout?: number;
  execution?: {
    launcherId?: string;
    cwd?: string;
    inheritAgent?: boolean;
  };
}

function JobsTab({ slug }: { slug: string }) {
  const [jobs, setJobs] = useState<AgentJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCron, setNewCron] = useState("0 9 * * 1-5");
  const [newPrompt, setNewPrompt] = useState("");
  const [newLauncherId, setNewLauncherId] = useState("");
  const [newCwd, setNewCwd] = useState("");
  const [editingJob, setEditingJob] = useState<string | null>(null);
  const [editCron, setEditCron] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const [editLauncherId, setEditLauncherId] = useState("");
  const [editCwd, setEditCwd] = useState("");
  const [running, setRunning] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/${slug}/jobs`);
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs || []);
      }
    } catch {}
    setLoading(false);
  }, [slug]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleAdd = async () => {
    if (!newName.trim() || !newPrompt.trim()) return;
    await fetch(`/api/agents/${slug}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newName.trim(),
        schedule: newCron,
        prompt: newPrompt.trim(),
        execution:
          newLauncherId || newCwd
            ? {
                inheritAgent: !newLauncherId,
                launcherId: newLauncherId || undefined,
                cwd: newCwd || undefined,
              }
            : undefined,
      }),
    });
    setAdding(false);
    setNewName("");
    setNewCron("0 9 * * 1-5");
    setNewPrompt("");
    setNewLauncherId("");
    setNewCwd("");
    refresh();
  };

  const handleDelete = async (jobId: string) => {
    await fetch(`/api/agents/${slug}/jobs/${jobId}`, { method: "DELETE" });
    refresh();
  };

  const handleUpdateJob = async (jobId: string) => {
    const job = jobs.find((j) => j.id === jobId);
    if (!job) return;
    const updates: Record<string, unknown> = {};
    if (editCron && editCron !== job.schedule) updates.schedule = editCron;
    if (editPrompt !== job.prompt) updates.prompt = editPrompt;
    if (editLauncherId !== (job.execution?.launcherId || "") || editCwd !== (job.execution?.cwd || "")) {
      updates.execution =
        editLauncherId || editCwd
          ? {
              inheritAgent: !editLauncherId,
              launcherId: editLauncherId || undefined,
              cwd: editCwd || undefined,
            }
          : undefined;
    }
    if (Object.keys(updates).length > 0) {
      await fetch(`/api/agents/${slug}/jobs/${jobId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
    }
    setEditingJob(null);
    refresh();
  };

  const handleToggle = async (jobId: string) => {
    await fetch(`/api/agents/${slug}/jobs/${jobId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle" }),
    });
    refresh();
  };

  const handleRun = async (jobId: string) => {
    setRunning(jobId);
    await fetch(`/api/agents/${slug}/jobs/${jobId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "run" }),
    });
    setRunning(null);
    refresh();
  };

  if (loading) {
    return <p className="text-[13px] text-muted-foreground">Loading jobs...</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
          Scheduled Jobs
        </p>
        <Button
          variant="outline"
          size="sm"
          className="h-6 text-[10px] gap-1"
          onClick={() => setAdding(true)}
        >
          <Plus className="h-3 w-3" />
          Add Job
        </Button>
      </div>

      {adding && (
        <div className="bg-card border border-border rounded-lg p-3 space-y-3">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Job name..."
            className="w-full bg-background border border-border rounded px-2 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary/50"
            onKeyDown={(e) => { if (e.key === "Escape") setAdding(false); }}
          />
          <div>
            <p className="text-[10px] text-muted-foreground mb-1.5">Schedule</p>
            <CronPicker value={newCron} onChange={setNewCron} />
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground mb-1.5">Prompt</p>
            <textarea
              value={newPrompt}
              onChange={(e) => setNewPrompt(e.target.value)}
              placeholder="What should this job do?"
              className="w-full bg-background border border-border rounded px-2 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none min-h-[80px]"
            />
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground mb-1.5">Launcher ID</p>
            <input
              value={newLauncherId}
              onChange={(e) => setNewLauncherId(e.target.value)}
              placeholder="inherit agent launcher"
              className="w-full bg-background border border-border rounded px-2 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground mb-1.5">Working Directory</p>
            <input
              value={newCwd}
              onChange={(e) => setNewCwd(e.target.value)}
              placeholder="relative to configured vault"
              className="w-full bg-background border border-border rounded px-2 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>
          <div className="flex gap-1 justify-end">
            <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button size="sm" className="h-6 text-[10px]" onClick={handleAdd} disabled={!newName.trim() || !newPrompt.trim()}>
              Create
            </Button>
          </div>
        </div>
      )}

      {jobs.length === 0 && !adding && (
        <div className="text-center py-8">
          <Briefcase className="h-8 w-8 mx-auto text-muted-foreground/30" />
          <p className="text-[13px] text-muted-foreground mt-2">
            No jobs configured
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            Jobs are recurring scheduled tasks the agent runs automatically.
          </p>
        </div>
      )}

      {jobs.map((job) => (
        <div
          key={job.id}
          className="bg-card border border-border rounded-lg p-3"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleToggle(job.id)}
                className={cn(
                  "w-2 h-2 rounded-full shrink-0 cursor-pointer",
                  job.enabled ? "bg-green-500" : "bg-muted-foreground/30"
                )}
                title={job.enabled ? "Enabled — click to disable" : "Disabled — click to enable"}
              />
              <h4 className="text-[13px] font-medium">{job.name}</h4>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-5 text-[10px] gap-1 px-1.5"
                onClick={() => handleRun(job.id)}
                disabled={running === job.id}
              >
                {running === job.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                Run
              </Button>
              <button
                onClick={() => { setEditingJob(editingJob === job.id ? null : job.id); setEditCron(job.schedule); setEditPrompt(job.prompt); setEditLauncherId(job.execution?.launcherId || ""); setEditCwd(job.execution?.cwd || ""); }}
                className={cn(
                  "text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded hover:bg-muted/80 transition-colors",
                  editingJob === job.id ? "ring-1 ring-primary/50" : ""
                )}
              >
                <span className="font-mono">{job.schedule}</span>
                <span className="ml-1 text-muted-foreground/50">({cronToHuman(job.schedule)})</span>
              </button>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-muted-foreground/40 hover:text-destructive"
                onClick={() => handleDelete(job.id)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
          {job.prompt && editingJob !== job.id && (
            <p className="text-[11px] text-muted-foreground/70 mt-1.5 line-clamp-2">{job.prompt}</p>
          )}
          {editingJob === job.id && (
            <div className="mt-2 pt-2 border-t border-border space-y-3">
              <div>
                <p className="text-[10px] text-muted-foreground mb-1.5">Schedule</p>
                <CronPicker
                  value={editCron}
                  onChange={(v) => setEditCron(v)}
                  compact
                />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground mb-1.5">Prompt</p>
                <textarea
                  value={editPrompt}
                  onChange={(e) => setEditPrompt(e.target.value)}
                  placeholder="What should this job do?"
                  className="w-full bg-background border border-border rounded px-2 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none min-h-[80px]"
                />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground mb-1.5">Launcher ID</p>
                <input
                  value={editLauncherId}
                  onChange={(e) => setEditLauncherId(e.target.value)}
                  placeholder="inherit agent launcher"
                  className="w-full bg-background border border-border rounded px-2 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground mb-1.5">Working Directory</p>
                <input
                  value={editCwd}
                  onChange={(e) => setEditCwd(e.target.value)}
                  placeholder="relative to configured vault"
                  className="w-full bg-background border border-border rounded px-2 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
              <div className="flex gap-1 justify-end">
                <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => setEditingJob(null)}>
                  Cancel
                </Button>
                <Button size="sm" className="h-6 text-[10px] gap-1" onClick={() => handleUpdateJob(job.id)}>
                  <Save className="h-3 w-3" />
                  Save
                </Button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ─── Sessions Tab (launcher-backed terminal) ─── */
function SessionsTab({
  persona,
  history,
  onRefresh,
}: {
  persona: AgentPersona;
  history: HeartbeatRecord[];
  onRefresh: () => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [prompt, setPrompt] = useState("");
  const [startingSession, setStartingSession] = useState(false);
  const [copiedTmux, setCopiedTmux] = useState(false);
  // Live terminal session
  const [liveSession, setLiveSession] = useState<{
    id: string;
    userMessage: string;
    tmuxSessionName?: string | null;
    tmuxAttachCommand?: string | null;
  } | null>(null);

  const selectedSession = selectedIndex !== null ? history[selectedIndex] : null;

  const handleSendPrompt = async () => {
    if (!prompt.trim()) return;
    const userMessage = prompt.trim();
    const sessionId = `agent-${persona.slug}-${Date.now()}`;
    const fullPrompt = `${persona.body}\n\n---\n\nUser request: ${userMessage}`;

    setStartingSession(true);
    try {
      const res = await fetch("/api/daemon/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          agentSlug: persona.slug,
          prompt: fullPrompt,
        }),
      });
      if (!res.ok) throw new Error("Failed to start session");
      const data = await res.json();
      setLiveSession({
        id: data.sessionId || sessionId,
        userMessage,
        tmuxSessionName: data.tmuxSessionName,
        tmuxAttachCommand: data.tmuxAttachCommand,
      });
      setCopiedTmux(false);
      setSelectedIndex(null);
      setPrompt("");
    } catch {
      // ignore for now
    } finally {
      setStartingSession(false);
    }
  };

  const handleSessionEnd = () => {
    setLiveSession(null);
    onRefresh();
  };

  const handleNewSession = () => {
    setSelectedIndex(null);
    setLiveSession(null);
    setCopiedTmux(false);
  };

  const handleCopyTmuxCommand = async () => {
    if (!liveSession?.tmuxAttachCommand) return;
    try {
      await navigator.clipboard.writeText(liveSession.tmuxAttachCommand);
      setCopiedTmux(true);
      window.setTimeout(() => setCopiedTmux(false), 2000);
    } catch {
      // ignore clipboard failures
    }
  };

  const showNewPrompt = !liveSession && selectedIndex === null;

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Session list sidebar */}
      <div className="w-[240px] min-w-[240px] border-r border-border flex flex-col bg-muted/5">
        <div className="px-3 py-2 border-b border-border flex items-center justify-between">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            History
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleNewSession}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-1.5 space-y-0.5">
            {/* Live session entry */}
            {(liveSession || startingSession) && (
              <button
                className="flex items-start gap-2 w-full px-2.5 py-2 rounded-md text-[11px] text-left bg-primary/10 border border-primary/20"
              >
                <div className="mt-0.5 shrink-0">
                  <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-[11px] leading-tight text-foreground">
                    {liveSession?.userMessage || prompt}
                  </p>
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                    {startingSession ? "starting..." : "running..."}
                  </p>
                </div>
              </button>
            )}
            {history.length === 0 && !liveSession && (
              <p className="text-[11px] text-muted-foreground/50 px-2 py-6 text-center">
                No sessions yet
              </p>
            )}
            {history.map((hb, i) => {
              const date = new Date(hb.timestamp);
              const summaryLine = hb.summary
                ?.replace(/^---\s*\n/, "")
                ?.replace(/^#+\s*/, "")
                ?.split("\n")[0]
                ?.trim() || "Session";
              return (
                <button
                  key={i}
                  onClick={() => {
                    setSelectedIndex(i);
                    setLiveSession(null);
                  }}
                  className={cn(
                    "flex items-start gap-2 w-full px-2.5 py-2 rounded-md text-[11px] transition-colors text-left group",
                    selectedIndex === i
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  )}
                >
                  <div className="mt-0.5 shrink-0">
                    {hb.status === "completed" ? (
                      <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-red-500" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-[11px] leading-tight">
                      {summaryLine.length > 50 ? summaryLine.slice(0, 50) + "..." : summaryLine}
                    </p>
                    <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                      {date.toLocaleDateString([], {
                        month: "short",
                        day: "numeric",
                      })}
                      {" "}
                      {date.toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      <span className="ml-1.5">
                        {Math.round(hb.duration / 1000)}s
                      </span>
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {/* Session content panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {liveSession ? (
          /* Live launcher-backed terminal */
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border flex items-center justify-between gap-3 shrink-0">
              <div className="min-w-0 flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 text-primary animate-spin shrink-0" />
                <div className="min-w-0">
                  <div className="text-[12px] font-medium truncate">{liveSession.userMessage}</div>
                  {liveSession.tmuxSessionName ? (
                    <div className="text-[10px] text-muted-foreground font-mono truncate">
                      {liveSession.tmuxSessionName}
                    </div>
                  ) : null}
                </div>
              </div>
              {liveSession.tmuxAttachCommand ? (
                <Button
                  variant="outline"
                  size="xs"
                  className="shrink-0"
                  onClick={() => void handleCopyTmuxCommand()}
                  title={liveSession.tmuxAttachCommand}
                >
                  {copiedTmux ? (
                    <>
                      <Check className="h-3 w-3" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      tmux
                    </>
                  )}
                </Button>
              ) : null}
            </div>
            <div className="flex-1 min-h-0">
              <WebTerminal
                sessionId={liveSession.id}
                onClose={handleSessionEnd}
              />
            </div>
          </div>
        ) : selectedSession ? (
          /* Viewing a past session */
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
              {selectedSession.status === "completed" ? (
                <CheckCircle className="h-3.5 w-3.5 text-green-500" />
              ) : (
                <XCircle className="h-3.5 w-3.5 text-red-500" />
              )}
              <span className="text-[12px] font-medium capitalize">
                {selectedSession.status}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {Math.round(selectedSession.duration / 1000)}s
              </span>
              <span className="text-[10px] text-muted-foreground ml-auto">
                {new Date(selectedSession.timestamp).toLocaleString([], {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-4">
                <pre className="text-[12px] font-mono whitespace-pre-wrap leading-relaxed text-foreground/90">
                  {selectedSession.summary || "No output captured for this session."}
                </pre>
              </div>
            </ScrollArea>
            <div className="border-t border-border p-3">
              <div className="flex gap-2">
                <input
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendPrompt();
                    }
                  }}
                  placeholder={`Ask ${persona.name} something...`}
                  className="flex-1 px-3 py-1.5 text-[13px] rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
                <Button
                  size="sm"
                  className="h-8 gap-1"
                  onClick={handleSendPrompt}
                  disabled={!prompt.trim()}
                >
                  <Send className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        ) : showNewPrompt ? (
          /* New session prompt */
          <div className="flex-1 flex flex-col items-center justify-center px-8">
            <div className="text-center mb-6">
              <MessageSquare className="h-10 w-10 mx-auto text-muted-foreground/20 mb-3" />
              <h3 className="text-[14px] font-medium text-foreground/80">
                New Session
              </h3>
              <p className="text-[12px] text-muted-foreground mt-1 max-w-sm">
                Send a prompt to {persona.name} to start a live launcher-backed session.
              </p>
            </div>
            <div className="w-full max-w-lg">
              <div className="flex gap-2">
                <input
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendPrompt();
                    }
                  }}
                  placeholder={`Ask ${persona.name} something...`}
                  className="flex-1 px-3 py-2 text-[13px] rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary/50"
                  autoFocus
                />
                <Button
                  size="sm"
                  className="h-9 gap-1.5"
                  onClick={handleSendPrompt}
                  disabled={!prompt.trim() || startingSession}
                >
                  <Send className="h-3.5 w-3.5" />
                  {startingSession ? "Starting..." : "Send"}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ─── Main Component ─── */
export function AgentDetail({ slug }: { slug: string }) {
  const [persona, setPersona] = useState<AgentPersona | null>(null);
  const [history, setHistory] = useState<HeartbeatRecord[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>("definition");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [toggling, setToggling] = useState(false);
  const setSection = useAppStore((s) => s.setSection);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/personas/${slug}`);
      if (res.ok) {
        const data = await res.json();
        setPersona(data.persona);
        setHistory(data.history || []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleRun = async () => {
    setRunning(true);
    await fetch(`/api/agents/personas/${slug}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "run" }),
    });
    setTimeout(() => {
      setRunning(false);
      refresh();
    }, 2000);
  };

  const handleToggle = async () => {
    setToggling(true);
    await fetch(`/api/agents/personas/${slug}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle" }),
    });
    setToggling(false);
    refresh();
  };

  if (loading || !persona) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setSection({ type: "agents" })}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <AgentAvatar name={persona.name} slug={persona.slug} size="md" />
          <div>
            <h2 className="text-[15px] font-semibold tracking-[-0.02em]">
              {persona.name}
            </h2>
            <p className="text-[11px] text-muted-foreground">{persona.role}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={handleRun}
            disabled={running}
          >
            <Zap className="h-3 w-3" />
            {running ? "Running..." : "Run"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={handleToggle}
            disabled={toggling}
          >
            {persona.active ? (
              <Pause className="h-3 w-3" />
            ) : (
              <Play className="h-3 w-3" />
            )}
            {persona.active ? "Pause" : "Activate"}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={refresh}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Body: vertical sidebar nav + content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Vertical tab sidebar */}
        <div className="w-[160px] min-w-[160px] border-r border-border flex flex-col bg-muted/5 py-2">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-2 mx-2 px-2.5 py-2 rounded-md text-[12px] font-medium transition-colors text-left",
                  activeTab === tab.id
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        {activeTab === "sessions" ? (
          <SessionsTab
            persona={persona}
            history={history}
            onRefresh={refresh}
          />
        ) : (
          <ScrollArea className="flex-1">
            <div className="p-4">
              {activeTab === "definition" && <DefinitionTab persona={persona} slug={slug} onRefresh={refresh} />}
              {activeTab === "jobs" && <JobsTab slug={slug} />}


            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}
