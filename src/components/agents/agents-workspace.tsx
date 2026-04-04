"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Bot,
  Loader2,
  Pause,
  Play,
  Plus,
  Settings,
  Trash2,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { AgentJobsEditor } from "@/components/agents/agent-jobs-editor";
import { AgentsConversationList } from "@/components/agents/agents-conversation-list";
import { AgentsWorkspaceComposer } from "@/components/agents/agents-workspace-composer";
import { WebTerminal } from "@/components/terminal/web-terminal";
import { useAgentsWorkspaceData } from "@/components/agents/use-agents-workspace-data";
import {
  collectContextOptions,
  flattenTree,
  slugify,
  togglePath,
  TRIGGER_LABELS,
  type StatusFilter,
  type TriggerFilter,
} from "@/components/agents/agents-workspace.helpers";
import {
  createAgentJob,
  createAgentPersona,
  createManualConversation,
  deleteAgentJob,
  deleteAgentPersona,
  getAgentStack,
  runAgentJob,
  runAgentPersona,
  saveAgentJob,
  saveAgentPersona,
  saveAgentStack,
  toggleAgentPersona,
} from "@/lib/api/agents-client";
import { replacePastedTextNotice } from "@/lib/agents/transcript-format";
import { useTreeStore } from "@/stores/tree-store";
import { useAppStore } from "@/stores/app-store";
import type { CreateAgentPersonaRequest } from "@/types/agent-api";
import type { AgentStackPayload, StackCatalogEntry } from "@/types/agent-stack";
import type { JobConfig } from "@/types/jobs";

type MainPanelMode = "composer" | "conversation" | "settings";
type NonSettingsMode = Exclude<MainPanelMode, "settings">;
type SettingsTarget = "directory" | "__new__" | string | null;
type AgentSettingsTab = "definition" | "stack" | "jobs";
type StackEditorTab = "context" | "extensions" | "skills";

interface NewAgentDraft {
  name: string;
  slug: string;
  emoji: string;
  role: string;
  heartbeat: string;
  department: string;
  type: string;
  workspace: string;
  body: string;
  active: boolean;
}

const DEFAULT_NEW_AGENT: NewAgentDraft = {
  name: "",
  slug: "",
  emoji: "",
  role: "",
  heartbeat: "0 */4 * * *",
  department: "general",
  type: "specialist",
  workspace: "workspace",
  body: "",
  active: true,
};

function AgentSettingsTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

function PathAutosuggestInput({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { path: string; title: string }[];
  placeholder?: string;
}) {
  const [focused, setFocused] = useState(false);
  const normalizedQuery = value.trim().toLowerCase();
  const suggestions =
    !normalizedQuery
      ? []
      : options
          .filter(
            (option) =>
              option.path.toLowerCase().includes(normalizedQuery) ||
              option.title.toLowerCase().includes(normalizedQuery)
          )
          .slice(0, 8);

  return (
    <div className="relative">
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 120)}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-[12px] text-foreground"
        spellCheck={false}
        placeholder={placeholder}
      />
      {focused && suggestions.length > 0 ? (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
          {suggestions.map((option) => (
            <button
              key={option.path}
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
                onChange(option.path);
                setFocused(false);
              }}
              className="flex w-full items-start gap-3 px-3 py-2 text-left hover:bg-accent/50"
            >
              <span className="min-w-0">
                <span className="block truncate text-[12px] text-foreground">
                  {option.title}
                </span>
                <span className="block truncate font-mono text-[10px] text-muted-foreground">
                  {option.path}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StackOptionChecklist({
  label,
  options,
  selected,
  onToggle,
  filterText = "",
  emptyText = "No options found.",
}: {
  label: string;
  options: StackCatalogEntry[];
  selected: string[];
  onToggle: (path: string) => void;
  filterText?: string;
  emptyText?: string;
}) {
  const normalizedFilter = filterText.trim().toLowerCase();
  const filteredOptions = options
    .filter((option) => {
      if (!normalizedFilter) return true;
      return (
        option.label.toLowerCase().includes(normalizedFilter) ||
        option.path.toLowerCase().includes(normalizedFilter) ||
        option.source.toLowerCase().includes(normalizedFilter)
      );
    })
    .sort((left, right) => {
      const leftSelected = selected.includes(left.path) ? 1 : 0;
      const rightSelected = selected.includes(right.path) ? 1 : 0;
      if (leftSelected !== rightSelected) return rightSelected - leftSelected;
      return left.label.localeCompare(right.label);
    });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className="text-[10px] text-muted-foreground">
          {selected.length} selected
        </p>
      </div>
      <div className="max-h-[440px] space-y-1 overflow-auto rounded-xl border border-border bg-background/60 p-2">
        {filteredOptions.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            {normalizedFilter ? `No matches for “${filterText}”.` : emptyText}
          </p>
        ) : (
          filteredOptions.map((option) => (
            <label
              key={option.path}
              className="flex items-start gap-2 rounded-lg px-2 py-2 hover:bg-muted/40"
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

function AgentStackSettingsCard({
  slug,
}: {
  slug: string;
}) {
  const nodes = useTreeStore((s) => s.nodes);
  const [payload, setPayload] = useState<AgentStackPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<StackEditorTab>("context");
  const [contextCandidate, setContextCandidate] = useState("");
  const [extensionFilter, setExtensionFilter] = useState("");
  const [skillFilter, setSkillFilter] = useState("");
  const [skillsetFilter, setSkillsetFilter] = useState("");
  const contextOptions = useMemo(() => collectContextOptions(nodes), [nodes]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setPayload(await getAgentStack(slug));
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

  useEffect(() => {
    setActiveTab("context");
    setContextCandidate("");
    setExtensionFilter("");
    setSkillFilter("");
    setSkillsetFilter("");
  }, [slug]);

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
      await saveAgentStack(slug, payload.stack);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save stack");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-border p-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h4 className="text-[13px] font-semibold">Stack configuration</h4>
          <p className="text-[11px] text-muted-foreground">
            Extensions, skill stacks, and injected context for the actual pi stack file
          </p>
          {payload?.stackPath ? (
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">
              {payload.stackPath}
            </p>
          ) : null}
        </div>
        <Button size="sm" className="h-8 text-xs" onClick={save} disabled={saving || !payload?.stack}>
          {saving ? "Saving..." : "Save stack"}
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading stack...
        </div>
      ) : !payload?.stack ? (
        <div className="text-[12px] text-muted-foreground">
          No stack file is currently wired for this agent.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <AgentSettingsTabButton
              active={activeTab === "context"}
              onClick={() => setActiveTab("context")}
            >
              Context
            </AgentSettingsTabButton>
            <AgentSettingsTabButton
              active={activeTab === "extensions"}
              onClick={() => setActiveTab("extensions")}
            >
              Extensions
            </AgentSettingsTabButton>
            <AgentSettingsTabButton
              active={activeTab === "skills"}
              onClick={() => setActiveTab("skills")}
            >
              Skills
            </AgentSettingsTabButton>
          </div>

          {activeTab === "context" ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                <label className="space-y-1.5 text-[11px] text-muted-foreground">
                  <span>Primary context</span>
                  <PathAutosuggestInput
                    value={payload.stack.paths?.primary || ""}
                    onChange={(value) => updatePaths("primary", value)}
                    options={contextOptions}
                    placeholder="Start typing a note title or vault path"
                  />
                </label>
                <label className="space-y-1.5 text-[11px] text-muted-foreground">
                  <span>Secondary context</span>
                  <PathAutosuggestInput
                    value={payload.stack.paths?.secondary || ""}
                    onChange={(value) => updatePaths("secondary", value)}
                    options={contextOptions}
                    placeholder="Start typing a note title or vault path"
                  />
                </label>
                <label className="space-y-1.5 text-[11px] text-muted-foreground">
                  <span>Tertiary context</span>
                  <PathAutosuggestInput
                    value={payload.stack.paths?.tertiary || ""}
                    onChange={(value) => updatePaths("tertiary", value)}
                    options={contextOptions}
                    placeholder="Start typing a note title or vault path"
                  />
                </label>
              </div>

              <div className="rounded-xl border border-border bg-background/40 p-4">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
                  <div>
                    <p className="text-[12px] font-medium text-foreground">Extra context files</p>
                    <p className="text-[11px] text-muted-foreground">
                      Add supporting notes that should always be injected with the stack.
                    </p>
                  </div>
                  <div className="flex w-full flex-col gap-2 xl:w-[560px] xl:flex-row">
                    <div className="flex-1">
                      <PathAutosuggestInput
                        value={contextCandidate}
                        onChange={setContextCandidate}
                        options={contextOptions}
                        placeholder="Start typing a note title or vault path"
                      />
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 text-xs"
                      onClick={() => {
                        const candidate = contextCandidate.trim();
                        if (!candidate) return;
                        updateList(
                          "contextFiles",
                          payload.stack?.contextFiles?.includes(candidate)
                            ? payload.stack.contextFiles || []
                            : [...(payload.stack?.contextFiles || []), candidate]
                        );
                        setContextCandidate("");
                      }}
                    >
                      Add file
                    </Button>
                  </div>
                </div>
                <div className="mt-3 flex min-h-[56px] flex-wrap gap-2 rounded-lg border border-border bg-background/60 p-3">
                  {(payload.stack.contextFiles || []).length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">No extra context files selected.</p>
                  ) : (
                    (payload.stack.contextFiles || []).map((path) => (
                      <button
                        key={path}
                        onClick={() =>
                          updateList(
                            "contextFiles",
                            (payload.stack?.contextFiles || []).filter((entry) => entry !== path)
                          )
                        }
                        className="rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                        title="Remove"
                      >
                        {path}
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {activeTab === "extensions" ? (
            <div className="space-y-4 rounded-xl border border-border bg-background/40 p-4">
              <div className="flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <p className="text-[12px] font-medium text-foreground">Extension stack</p>
                  <p className="text-[11px] text-muted-foreground">
                    Choose runtime extensions to load on top of the shared agent shell.
                  </p>
                </div>
                <label className="space-y-1 text-[11px] text-muted-foreground xl:w-[420px]">
                  <span>Filter extensions</span>
                  <input
                    value={extensionFilter}
                    onChange={(event) => setExtensionFilter(event.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[12px] text-foreground"
                    placeholder="Filter by extension name or path"
                  />
                </label>
              </div>
              <StackOptionChecklist
                label="Extensions"
                options={payload.catalog.extensions}
                selected={payload.stack.extraExtensions || []}
                filterText={extensionFilter}
                onToggle={(path) =>
                  updateList(
                    "extraExtensions",
                    togglePath(payload.stack?.extraExtensions || [], path)
                  )
                }
              />
            </div>
          ) : null}

          {activeTab === "skills" ? (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <div className="space-y-4 rounded-xl border border-border bg-background/40 p-4">
                <div className="space-y-2">
                  <div>
                    <p className="text-[12px] font-medium text-foreground">Skills</p>
                    <p className="text-[11px] text-muted-foreground">
                      Add direct skill notes that should be available to the agent.
                    </p>
                  </div>
                  <label className="space-y-1 text-[11px] text-muted-foreground">
                    <span>Filter skills</span>
                    <input
                      value={skillFilter}
                      onChange={(event) => setSkillFilter(event.target.value)}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[12px] text-foreground"
                      placeholder="Filter by skill name or path"
                    />
                  </label>
                </div>
                <StackOptionChecklist
                  label="Skills"
                  options={payload.catalog.skills}
                  selected={payload.stack.skills || []}
                  filterText={skillFilter}
                  onToggle={(path) =>
                    updateList("skills", togglePath(payload.stack?.skills || [], path))
                  }
                />
              </div>

              <div className="space-y-4 rounded-xl border border-border bg-background/40 p-4">
                <div className="space-y-2">
                  <div>
                    <p className="text-[12px] font-medium text-foreground">Skillsets</p>
                    <p className="text-[11px] text-muted-foreground">
                      Add grouped skill bundles that should load with this stack.
                    </p>
                  </div>
                  <label className="space-y-1 text-[11px] text-muted-foreground">
                    <span>Filter skillsets</span>
                    <input
                      value={skillsetFilter}
                      onChange={(event) => setSkillsetFilter(event.target.value)}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[12px] text-foreground"
                      placeholder="Filter by skillset name or path"
                    />
                  </label>
                </div>
                <StackOptionChecklist
                  label="Skillsets"
                  options={payload.catalog.skillsets}
                  selected={payload.stack.skillsets || []}
                  filterText={skillsetFilter}
                  onToggle={(path) =>
                    updateList(
                      "skillsets",
                      togglePath(payload.stack?.skillsets || [], path)
                    )
                  }
                />
              </div>
            </div>
          ) : null}

          {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
        </div>
      )}
    </div>
  );
}

export function AgentsWorkspace({
  selectedAgentSlug,
  selectedScope = "all",
  initialMode = "composer",
  initialSettingsTarget = null,
}: {
  selectedAgentSlug?: string | null;
  selectedScope?: "all" | "agent";
  initialMode?: "composer" | "settings";
  initialSettingsTarget?: string | null;
}) {
  const [mode, setMode] = useState<MainPanelMode>("composer");
  const [previousMode, setPreviousMode] = useState<NonSettingsMode>("composer");
  const [activeAgentSlug, setActiveAgentSlug] = useState<string | null>(
    selectedScope === "agent" ? selectedAgentSlug || null : null
  );
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [settingsTarget, setSettingsTarget] = useState<SettingsTarget>(null);
  const [activeSettingsTab, setActiveSettingsTab] = useState<AgentSettingsTab>("definition");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [jobDraft, setJobDraft] = useState<JobConfig | null>(null);
  const [triggerFilter, setTriggerFilter] = useState<TriggerFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [composerInput, setComposerInput] = useState("");
  const [mentionedPaths, setMentionedPaths] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [deletingAgent, setDeletingAgent] = useState(false);
  const [newAgentDraft, setNewAgentDraft] = useState<NewAgentDraft>(DEFAULT_NEW_AGENT);
  const treeNodes = useTreeStore((state) => state.nodes);
  const selectedPath = useTreeStore((state) => state.selectedPath);
  const selectedNode = useTreeStore((state) =>
    state.selectedPath ? state.nodeByPath[state.selectedPath] ?? null : null
  );
  const selectPage = useTreeStore((state) => state.selectPage);
  const section = useAppStore((state) => state.section);
  const setSection = useAppStore((state) => state.setSection);
  const agentSettingsReturnSection = useAppStore(
    (state) => state.agentSettingsReturnSection
  );
  const setAgentSettingsReturnSection = useAppStore(
    (state) => state.setAgentSettingsReturnSection
  );

  const settingsAgentSlug =
    settingsTarget && settingsTarget !== "directory" && settingsTarget !== "__new__"
      ? settingsTarget
      : null;
  const allPages = useMemo(() => flattenTree(treeNodes), [treeNodes]);
  const {
    agents,
    conversations,
    conversationsLoading,
    hasLoadedConversations,
    selectedConversation,
    settingsPersona,
    setSettingsPersona,
    settingsBody,
    setSettingsBody,
    settingsJobs,
    refreshAgents,
    refreshConversations,
    refreshSettings,
  } = useAgentsWorkspaceData({
    activeAgentSlug,
    triggerFilter,
    statusFilter,
    selectedConversationId,
    settingsAgentSlug,
  });

  useEffect(() => {
    setActiveAgentSlug(selectedScope === "agent" ? selectedAgentSlug || null : null);
    setSelectedConversationId(null);
    if (initialMode === "settings") {
      setSettingsTarget(
        initialSettingsTarget ||
          (selectedScope === "agent" ? selectedAgentSlug || null : "directory")
      );
      setActiveSettingsTab("definition");
      setSelectedJobId(null);
      setJobDraft(null);
      setMode("settings");
      return;
    }
    setSettingsTarget(null);
    setMode("composer");
  }, [initialMode, initialSettingsTarget, selectedAgentSlug, selectedScope]);

  useEffect(() => {
    setSelectedJobId(null);
    setJobDraft(null);
  }, [settingsAgentSlug]);

  function selectAgent(agentSlug: string | null, nextMode: MainPanelMode = "composer") {
    setActiveAgentSlug(agentSlug);
    setSelectedConversationId(null);
    setSettingsTarget(null);
    setMode(nextMode);
    if (agentSlug) {
      setSection({ type: "agent", slug: agentSlug });
    } else {
      setSection({ type: "agents" });
    }
  }

  function openAgentDirectory() {
    if (mode !== "settings") {
      setPreviousMode(mode === "conversation" ? "conversation" : "composer");
    }
    setMode("settings");
    setSettingsTarget("directory");
    setActiveSettingsTab("definition");
    setSelectedJobId(null);
    setJobDraft(null);
  }

  function openAgentSettings(agentSlug: string) {
    if (mode !== "settings") {
      setPreviousMode(mode === "conversation" ? "conversation" : "composer");
    }
    setMode("settings");
    setSettingsTarget(agentSlug);
    setActiveSettingsTab("definition");
    setSelectedJobId(null);
    setJobDraft(null);
  }

  function startNewAgentDraft() {
    if (mode !== "settings") {
      setPreviousMode(mode === "conversation" ? "conversation" : "composer");
    }
    setMode("settings");
    setSettingsTarget("__new__");
    setActiveSettingsTab("definition");
    setSelectedJobId(null);
    setJobDraft(null);
    setNewAgentDraft(DEFAULT_NEW_AGENT);
  }

  function exitSettings() {
    if (section.view === "settings") {
      setSection(agentSettingsReturnSection || { type: "page" });
      setAgentSettingsReturnSection(null);
      return;
    }
    setSettingsTarget(null);
    setSelectedJobId(null);
    setJobDraft(null);
    setMode(selectedConversationId && previousMode === "conversation" ? "conversation" : "composer");
  }

  async function submitConversation() {
    if (!composerInput.trim()) return;
    if (!activeAgentSlug) return;

    setSubmitting(true);
    try {
      const conversation = await createManualConversation({
        agentSlug: activeAgentSlug,
        userMessage: composerInput.trim(),
        mentionedPaths,
      }).catch(() => null);
      if (!conversation) return;
      setComposerInput("");
      setMentionedPaths([]);
      setSelectedConversationId(conversation.id);
      setMode("conversation");
      await refreshConversations();
    } finally {
      setSubmitting(false);
    }
  }

  async function saveAgentSettings() {
    if (!settingsAgentSlug || settingsAgentSlug === "general" || !settingsPersona) return;
    setSavingSettings(true);
    try {
      const result = await saveAgentPersona(settingsAgentSlug, {
        role: settingsPersona.role,
        department: settingsPersona.department,
        type: settingsPersona.type,
        heartbeat: settingsPersona.heartbeat,
        workspace: settingsPersona.workspace,
        body: settingsBody,
      }).catch(() => null);
      if (result === null) return;
      await refreshAgents();
      await refreshSettings(settingsAgentSlug);
    } finally {
      setSavingSettings(false);
    }
  }

  async function toggleAgentActive() {
    if (!settingsAgentSlug || settingsAgentSlug === "general") return;
    const result = await toggleAgentPersona(settingsAgentSlug).catch(() => null);
    if (!result) return;
    await refreshAgents();
    await refreshSettings(settingsAgentSlug);
  }

  async function runHeartbeatNow() {
    if (!settingsAgentSlug || settingsAgentSlug === "general") return;
    const data = await runAgentPersona(settingsAgentSlug).catch(() => null);
    if (data?.sessionId) {
      setActiveAgentSlug(settingsAgentSlug);
      setSection({ type: "agent", slug: settingsAgentSlug });
      setSettingsTarget(null);
      setSelectedConversationId(data.sessionId);
      setMode("conversation");
      await refreshConversations();
    }
  }

  function startNewJobDraft() {
    setActiveSettingsTab("jobs");
    setSelectedJobId("__new__");
    setJobDraft({
      id: "",
      name: "",
      enabled: true,
      schedule: "0 9 * * 1-5",
      provider: "claude-code",
      agentSlug: settingsAgentSlug || "",
      prompt: "",
      timeout: 600,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  function openJob(jobId: string) {
    const job = settingsJobs.find((entry) => entry.id === jobId);
    if (!job) return;
    setActiveSettingsTab("jobs");
    setSelectedJobId(jobId);
    setJobDraft({ ...job });
  }

  async function saveJob() {
    if (!settingsAgentSlug || !jobDraft) return;
    const isNew = selectedJobId === "__new__";
    if (isNew) {
      const created = await createAgentJob(settingsAgentSlug, jobDraft).catch(() => null);
      if (!created) return;
    } else if (selectedJobId) {
      const saved = await saveAgentJob(settingsAgentSlug, selectedJobId, {
        name: jobDraft.name,
        schedule: jobDraft.schedule,
        prompt: jobDraft.prompt,
        timeout: jobDraft.timeout,
        enabled: jobDraft.enabled,
      }).catch(() => null);
      if (!saved) return;
    }
    setSelectedJobId(null);
    setJobDraft(null);
    await refreshSettings(settingsAgentSlug);
  }

  async function deleteJob(jobId: string) {
    if (!settingsAgentSlug) return;
    const deleted = await deleteAgentJob(settingsAgentSlug, jobId).catch(() => null);
    if (deleted === null) return;
    setSelectedJobId(null);
    setJobDraft(null);
    await refreshSettings(settingsAgentSlug);
  }

  async function runJob(jobId: string) {
    if (!settingsAgentSlug) return;
    const run = await runAgentJob(settingsAgentSlug, jobId).catch(() => null);
    if (run?.id) {
      setActiveAgentSlug(settingsAgentSlug);
      setSection({ type: "agent", slug: settingsAgentSlug });
      setSettingsTarget(null);
      setSelectedConversationId(run.id);
      setMode("conversation");
      await refreshConversations();
    }
  }

  async function createAgent() {
    const slug = slugify(newAgentDraft.slug || newAgentDraft.name);
    if (!newAgentDraft.name.trim() || !newAgentDraft.role.trim() || !slug) return;

    setCreatingAgent(true);
    try {
      const payload: CreateAgentPersonaRequest = {
        slug,
        name: newAgentDraft.name.trim(),
        role: newAgentDraft.role.trim(),
        emoji: newAgentDraft.emoji,
        department: newAgentDraft.department,
        type: newAgentDraft.type,
        heartbeat: newAgentDraft.heartbeat,
        workspace: newAgentDraft.workspace || "workspace",
        provider: "claude-code",
        budget: 100,
        active: newAgentDraft.active,
        workdir: "/data",
        focus: [],
        tags: [newAgentDraft.department],
        channels:
          newAgentDraft.department === "general"
            ? ["general"]
            : [newAgentDraft.department, "general"],
        body:
          newAgentDraft.body.trim() ||
          `You are ${newAgentDraft.name.trim()}. ${newAgentDraft.role.trim()}`,
      };
      const result = await createAgentPersona(payload).catch(() => null);
      if (result === null) return;
      await refreshAgents();
      setSettingsTarget(slug);
      setNewAgentDraft(DEFAULT_NEW_AGENT);
      await refreshSettings(slug);
    } finally {
      setCreatingAgent(false);
    }
  }

  async function deleteAgent() {
    if (!settingsAgentSlug || settingsAgentSlug === "general") return;
    setDeletingAgent(true);
    try {
      const result = await deleteAgentPersona(settingsAgentSlug).catch(() => null);
      if (result === null) return;
      if (activeAgentSlug === settingsAgentSlug) {
        setActiveAgentSlug(null);
        setSection({ type: "agents" });
      }
      setSelectedConversationId(null);
      setSettingsTarget("directory");
      setSelectedJobId(null);
      setJobDraft(null);
      await refreshAgents();
      await refreshConversations();
    } finally {
      setDeletingAgent(false);
    }
  }

  const selectedConversationMeta = conversations.find(
    (conversation) => conversation.id === selectedConversationId
  );
  const activeAgent = activeAgentSlug
    ? agents.find((agent) => agent.slug === activeAgentSlug) || null
    : null;
  const settingsAgent = settingsAgentSlug
    ? agents.find((agent) => agent.slug === settingsAgentSlug) || null
    : null;
  const nextAgentSlug = slugify(newAgentDraft.slug || newAgentDraft.name);
  const canCreateAgent =
    Boolean(newAgentDraft.name.trim()) &&
    Boolean(newAgentDraft.role.trim()) &&
    Boolean(nextAgentSlug);
  const settingsReturnLabel =
    section.view === "settings"
      ? agentSettingsReturnSection?.type === "page"
        ? selectedNode?.frontmatter?.title ||
          selectedNode?.name ||
          selectedPath?.split("/").pop() ||
          "page"
        : agentSettingsReturnSection?.type === "jobs"
          ? "jobs"
          : agentSettingsReturnSection?.type === "settings"
            ? "settings"
            : agentSettingsReturnSection?.type === "agent"
              ? agentSettingsReturnSection.slug || "agent"
              : agentSettingsReturnSection?.type === "agents"
                ? "agents"
                : "workspace"
      : null;

  return (
    <div className="flex flex-1 overflow-hidden">
      <AgentsConversationList
        activeAgent={activeAgent}
        agents={agents}
        conversations={conversations}
        conversationsLoading={conversationsLoading}
        hasLoadedConversations={hasLoadedConversations}
        selectedConversationId={selectedConversationId}
        triggerFilter={triggerFilter}
        statusFilter={statusFilter}
        onTriggerFilterChange={setTriggerFilter}
        onStatusFilterChange={setStatusFilter}
        onRefresh={() => {
          void refreshAgents();
          void refreshConversations();
        }}
        onSelectConversation={(conversationId) => {
          setSelectedConversationId(conversationId);
          setMode("conversation");
        }}
      />

      <div className="flex-1 overflow-hidden">
        {mode === "conversation" && selectedConversationMeta ? (
          <div className="flex h-full flex-col">
            <div className="border-b border-border px-5 py-4">
              <div className="flex items-center gap-2">
                <AgentAvatar
                  name={agents.find((agent) => agent.slug === selectedConversationMeta.agentSlug)?.name}
                  slug={selectedConversationMeta.agentSlug}
                  size="md"
                />
                <div className="min-w-0">
                  <h3 className="truncate text-[15px] font-semibold">{selectedConversationMeta.title}</h3>
                  <p className="text-[11px] text-muted-foreground">
                    {selectedConversationMeta.agentSlug} · {TRIGGER_LABELS[selectedConversationMeta.trigger]} ·{" "}
                    {selectedConversationMeta.status}
                  </p>
                </div>
                <div className="ml-auto flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1 text-xs"
                    onClick={() => openAgentSettings(selectedConversationMeta.agentSlug)}
                  >
                    <Settings className="h-3.5 w-3.5" />
                    Settings
                  </Button>
                  {selectedConversation?.artifacts?.map((artifact) => (
                    <button
                      key={artifact.path}
                      onClick={() => {
                        selectPage(artifact.path);
                        setSection({ type: "page" });
                      }}
                      className="rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      {artifact.label || artifact.path}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex-1 overflow-hidden">
              {selectedConversationMeta.status === "running" ? (
                <WebTerminal
                  sessionId={selectedConversationMeta.id}
                  displayPrompt={selectedConversationMeta.title}
                  reconnect
                  onClose={() => {
                    void refreshConversations();
                  }}
                />
              ) : selectedConversation ? (
                <ScrollArea className="h-full bg-card/70">
                  <pre className="min-h-full whitespace-pre-wrap p-5 font-mono text-[12px] leading-relaxed text-foreground/85">
                    {replacePastedTextNotice(
                      selectedConversation.transcript || "No transcript captured.",
                      selectedConversationMeta.title
                    )}
                  </pre>
                </ScrollArea>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Loading conversation...
                </div>
              )}
            </div>
          </div>
        ) : mode === "settings" ? (
          <div className="flex h-full flex-col">
            <div className="border-b border-border px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                {settingsTarget === "directory" || !settingsTarget ? (
                  <div>
                    {settingsReturnLabel ? (
                      <button
                        onClick={exitSettings}
                        className="mb-2 flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <ArrowLeft className="h-3.5 w-3.5" />
                        Back to {settingsReturnLabel}
                      </button>
                    ) : null}
                    <h3 className="text-[15px] font-semibold">Agent settings</h3>
                    <p className="text-[11px] text-muted-foreground">
                      Big-picture management for your team. Add agents, remove agents, or open detailed settings.
                    </p>
                  </div>
                ) : settingsTarget === "__new__" ? (
                  <div className="flex items-center gap-3">
                    <AgentAvatar name={newAgentDraft.name || "New agent"} slug={newAgentDraft.slug || "agent"} size="lg" />
                    <div>
                      {settingsReturnLabel ? (
                        <button
                          onClick={exitSettings}
                          className="mb-2 flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <ArrowLeft className="h-3.5 w-3.5" />
                          Back to {settingsReturnLabel}
                        </button>
                      ) : null}
                      <h3 className="text-[15px] font-semibold">
                        {newAgentDraft.name.trim() || "New agent"}
                      </h3>
                      <p className="text-[11px] text-muted-foreground">
                        Start with the definition, then continue into stack and jobs once the agent exists.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <AgentAvatar name={settingsAgent?.name || "Agent settings"} slug={settingsAgent?.slug} size="lg" />
                    <div>
                      {settingsReturnLabel ? (
                        <button
                          onClick={exitSettings}
                          className="mb-2 flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <ArrowLeft className="h-3.5 w-3.5" />
                          Back to {settingsReturnLabel}
                        </button>
                      ) : null}
                      <h3 className="text-[15px] font-semibold">
                        {settingsAgent?.name || "Agent settings"}
                      </h3>
                      <p className="text-[11px] text-muted-foreground">
                        Definition, heartbeat, and jobs
                      </p>
                    </div>
                  </div>
                )}
                <div className="flex gap-2">
                  {(settingsTarget === "directory" || !settingsTarget) ? (
                    <Button size="sm" className="h-8 gap-1 text-xs" onClick={startNewAgentDraft}>
                      <Plus className="h-3.5 w-3.5" />
                      Add agent
                    </Button>
                  ) : null}
                  <Button variant="outline" size="sm" className="h-8 text-xs" onClick={exitSettings}>
                    {section.view === "settings" ? "Close" : "Done"}
                  </Button>
                </div>
              </div>
            </div>
            <ScrollArea className="h-full">
              <div className="space-y-6 p-5">
                {settingsTarget === "directory" || !settingsTarget ? (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {agents.map((agent) => (
                      <div
                        key={agent.slug}
                        className="rounded-2xl border border-border bg-card p-4 shadow-sm"
                      >
                        <div className="flex items-start gap-3">
                          <AgentAvatar name={agent.name} slug={agent.slug} size="lg" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <h4 className="truncate text-[14px] font-semibold">{agent.name}</h4>
                              <span
                                className={cn(
                                  "rounded-full px-1.5 py-0.5 text-[10px]",
                                  agent.active
                                    ? "bg-emerald-500/10 text-emerald-600"
                                    : "bg-muted text-muted-foreground"
                                )}
                              >
                                {agent.active ? "Active" : "Paused"}
                              </span>
                            </div>
                            <p className="mt-1 line-clamp-2 text-[12px] text-muted-foreground">
                              {agent.role}
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                              <span className="rounded-full bg-muted px-2 py-1">
                                {agent.runningCount || 0} running
                              </span>
                              {agent.heartbeat ? (
                                <span className="rounded-full bg-muted px-2 py-1">
                                  {agent.slug === "general" ? "Manual only" : agent.heartbeat}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                        <div className="mt-4 flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 flex-1 text-xs"
                            onClick={() => selectAgent(agent.slug, "composer")}
                          >
                            Open
                          </Button>
                          <Button
                            size="sm"
                            className="h-8 flex-1 gap-1 text-xs"
                            onClick={() => openAgentSettings(agent.slug)}
                          >
                            <Settings className="h-3.5 w-3.5" />
                            Settings
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : settingsTarget === "__new__" ? (
                  <>
                    <div className="rounded-xl border border-border p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <div>
                          <h4 className="text-[13px] font-semibold">Agent definition</h4>
                          <p className="text-[11px] text-muted-foreground">
                            Create the agent first, then continue into the full stack and jobs configuration.
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs"
                            onClick={openAgentDirectory}
                          >
                            Directory
                          </Button>
                          <Button
                            size="sm"
                            className="h-8 text-xs"
                            onClick={createAgent}
                            disabled={creatingAgent || !canCreateAgent}
                          >
                            {creatingAgent ? "Creating..." : "Create agent"}
                          </Button>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 border-t border-border pt-3">
                        <AgentSettingsTabButton
                          active={activeSettingsTab === "definition"}
                          onClick={() => setActiveSettingsTab("definition")}
                        >
                          Definition
                        </AgentSettingsTabButton>
                        <AgentSettingsTabButton
                          active={activeSettingsTab === "stack"}
                          onClick={() => setActiveSettingsTab("stack")}
                        >
                          Stack
                        </AgentSettingsTabButton>
                        <AgentSettingsTabButton
                          active={activeSettingsTab === "jobs"}
                          onClick={() => setActiveSettingsTab("jobs")}
                        >
                          Jobs
                        </AgentSettingsTabButton>
                      </div>
                    </div>

                    {activeSettingsTab === "definition" ? (
                      <div className="rounded-xl border border-border p-5">
                        <div className="mb-4">
                          <h4 className="text-[13px] font-semibold">Definition</h4>
                          <p className="text-[11px] text-muted-foreground">
                            Identity, cadence, workspace, and base instructions for the new agent.
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <label className="space-y-1.5 text-[11px] text-muted-foreground">
                            <span>Name</span>
                            <input
                              value={newAgentDraft.name}
                              onChange={(event) =>
                                setNewAgentDraft((current) => {
                                  const nextName = event.target.value;
                                  const currentDerivedSlug = slugify(current.name);
                                  return {
                                    ...current,
                                    name: nextName,
                                    slug:
                                      !current.slug || current.slug === currentDerivedSlug
                                        ? slugify(nextName)
                                        : current.slug,
                                  };
                                })
                              }
                              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground"
                              placeholder="Editor"
                            />
                          </label>
                          <label className="space-y-1.5 text-[11px] text-muted-foreground">
                            <span>Slug</span>
                            <input
                              value={newAgentDraft.slug}
                              onChange={(event) =>
                                setNewAgentDraft({
                                  ...newAgentDraft,
                                  slug: slugify(event.target.value),
                                })
                              }
                              className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-[13px] text-foreground"
                              placeholder="editor"
                            />
                          </label>
                          <label className="space-y-1.5 text-[11px] text-muted-foreground">
                            <span>Role</span>
                            <input
                              value={newAgentDraft.role}
                              onChange={(event) =>
                                setNewAgentDraft({ ...newAgentDraft, role: event.target.value })
                              }
                              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground"
                              placeholder="Product writing agent"
                            />
                          </label>
                          <label className="space-y-1.5 text-[11px] text-muted-foreground">
                            <span>Heartbeat</span>
                            <input
                              value={newAgentDraft.heartbeat}
                              onChange={(event) =>
                                setNewAgentDraft({
                                  ...newAgentDraft,
                                  heartbeat: event.target.value,
                                })
                              }
                              className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-[13px] text-foreground"
                            />
                          </label>
                          <label className="space-y-1.5 text-[11px] text-muted-foreground">
                            <span>Department</span>
                            <input
                              value={newAgentDraft.department}
                              onChange={(event) =>
                                setNewAgentDraft({
                                  ...newAgentDraft,
                                  department: event.target.value,
                                })
                              }
                              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground"
                            />
                          </label>
                          <label className="space-y-1.5 text-[11px] text-muted-foreground">
                            <span>Type</span>
                            <input
                              value={newAgentDraft.type}
                              onChange={(event) =>
                                setNewAgentDraft({ ...newAgentDraft, type: event.target.value })
                              }
                              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground"
                            />
                          </label>
                          <label className="space-y-1.5 text-[11px] text-muted-foreground">
                            <span>Avatar</span>
                            <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2">
                              <AgentAvatar name={newAgentDraft.name || "New agent"} slug={newAgentDraft.slug || "agent"} size="md" />
                              <span>Avatars are generated from agent names.</span>
                            </div>
                          </label>
                          <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={newAgentDraft.active}
                              onChange={(event) =>
                                setNewAgentDraft({
                                  ...newAgentDraft,
                                  active: event.target.checked,
                                })
                              }
                            />
                            Start active
                          </label>
                          <label className="col-span-2 space-y-1.5 text-[11px] text-muted-foreground">
                            <span>Workspace</span>
                            <input
                              value={newAgentDraft.workspace}
                              onChange={(event) =>
                                setNewAgentDraft({
                                  ...newAgentDraft,
                                  workspace: event.target.value,
                                })
                              }
                              className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-[13px] text-foreground"
                              placeholder="workspace"
                            />
                          </label>
                          <label className="col-span-2 space-y-1.5 text-[11px] text-muted-foreground">
                            <span>Instructions</span>
                            <textarea
                              value={newAgentDraft.body}
                              onChange={(event) =>
                                setNewAgentDraft({ ...newAgentDraft, body: event.target.value })
                              }
                              className="min-h-[320px] w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground"
                              placeholder="Define how this agent should work inside Yantra and the KB."
                            />
                          </label>
                        </div>
                        <div className="mt-4 rounded-xl border border-dashed border-border/70 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
                          Use the same definition fields you already have for existing agents. Once the
                          agent is created, this view automatically becomes the real settings screen with
                          stack and job editors.
                        </div>
                      </div>
                    ) : null}

                    {activeSettingsTab === "stack" ? (
                      <div className="rounded-xl border border-dashed border-border p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h4 className="text-[13px] font-semibold">Stack</h4>
                            <p className="text-[11px] text-muted-foreground">
                              Create the agent first. As soon as it exists, this tab becomes the full stack
                              editor used by existing agents.
                            </p>
                          </div>
                          <Button
                            size="sm"
                            className="h-8 text-xs"
                            onClick={createAgent}
                            disabled={creatingAgent || !canCreateAgent}
                          >
                            {creatingAgent ? "Creating..." : "Create and continue"}
                          </Button>
                        </div>
                        {!canCreateAgent ? (
                          <p className="mt-4 text-[11px] text-muted-foreground">
                            Fill in at least the name and role on the Definition tab before creating the
                            agent.
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    {activeSettingsTab === "jobs" ? (
                      <div className="rounded-xl border border-dashed border-border p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h4 className="text-[13px] font-semibold">Jobs</h4>
                            <p className="text-[11px] text-muted-foreground">
                              Jobs attach to a real agent. Create this one first, then schedule recurring
                              prompts from the same jobs editor used everywhere else.
                            </p>
                          </div>
                          <Button
                            size="sm"
                            className="h-8 text-xs"
                            onClick={createAgent}
                            disabled={creatingAgent || !canCreateAgent}
                          >
                            {creatingAgent ? "Creating..." : "Create and continue"}
                          </Button>
                        </div>
                        {!canCreateAgent ? (
                          <p className="mt-4 text-[11px] text-muted-foreground">
                            Fill in at least the name and role on the Definition tab before creating the
                            agent.
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                ) : settingsAgentSlug === "general" ? (
                  <div className="max-w-3xl space-y-4">
                    <div className="rounded-xl border border-border bg-card p-4 text-[13px] text-muted-foreground">
                      General is manual-only in this MVP. Use it as the default place for ad-hoc conversations, and manage the rest of the team from the agent directory.
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => selectAgent("general", "composer")}
                    >
                      Open General conversations
                    </Button>
                  </div>
                ) : settingsPersona ? (
                  <>
                    <div className="rounded-xl border border-border p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <div>
                          <h4 className="text-[13px] font-semibold">Agent definition</h4>
                          <p className="text-[11px] text-muted-foreground">Core identity and heartbeat settings</p>
                        </div>
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={runHeartbeatNow}>
                            <Zap className="h-3.5 w-3.5" />
                            Run heartbeat
                          </Button>
                          <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={toggleAgentActive}>
                            {settingsPersona.active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                            {settingsPersona.active ? "Pause" : "Activate"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 gap-1 text-xs text-destructive"
                            onClick={deleteAgent}
                            disabled={deletingAgent}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {deletingAgent ? "Removing..." : "Remove agent"}
                          </Button>
                          <Button size="sm" className="h-8 text-xs" onClick={saveAgentSettings} disabled={savingSettings}>
                            {savingSettings ? "Saving..." : "Save"}
                          </Button>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 border-t border-border pt-3">
                        <AgentSettingsTabButton
                          active={activeSettingsTab === "definition"}
                          onClick={() => setActiveSettingsTab("definition")}
                        >
                          Definition
                        </AgentSettingsTabButton>
                        <AgentSettingsTabButton
                          active={activeSettingsTab === "stack"}
                          onClick={() => setActiveSettingsTab("stack")}
                        >
                          Stack
                        </AgentSettingsTabButton>
                        <AgentSettingsTabButton
                          active={activeSettingsTab === "jobs"}
                          onClick={() => setActiveSettingsTab("jobs")}
                        >
                          Jobs
                        </AgentSettingsTabButton>
                      </div>
                    </div>

                    {activeSettingsTab === "definition" ? (
                      <div className="rounded-xl border border-border p-5">
                        <div className="mb-4">
                          <h4 className="text-[13px] font-semibold">Definition</h4>
                          <p className="text-[11px] text-muted-foreground">
                            Identity, cadence, and base instructions for this agent.
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <label className="space-y-1.5 text-[11px] text-muted-foreground">
                            <span>Role</span>
                            <input
                              value={settingsPersona.role || ""}
                              onChange={(event) =>
                                setSettingsPersona({ ...settingsPersona, role: event.target.value })
                              }
                              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground"
                            />
                          </label>
                          <label className="space-y-1.5 text-[11px] text-muted-foreground">
                            <span>Heartbeat</span>
                            <input
                              value={settingsPersona.heartbeat || ""}
                              onChange={(event) =>
                                setSettingsPersona({ ...settingsPersona, heartbeat: event.target.value })
                              }
                              className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-[13px] text-foreground"
                            />
                          </label>
                          <label className="space-y-1.5 text-[11px] text-muted-foreground">
                            <span>Department</span>
                            <input
                              value={settingsPersona.department || ""}
                              onChange={(event) =>
                                setSettingsPersona({ ...settingsPersona, department: event.target.value })
                              }
                              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground"
                            />
                          </label>
                          <label className="space-y-1.5 text-[11px] text-muted-foreground">
                            <span>Type</span>
                            <input
                              value={settingsPersona.type || ""}
                              onChange={(event) =>
                                setSettingsPersona({ ...settingsPersona, type: event.target.value })
                              }
                              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground"
                            />
                          </label>
                          <label className="col-span-2 space-y-1.5 text-[11px] text-muted-foreground">
                            <span>Workspace</span>
                            <input
                              value={settingsPersona.workspace || ""}
                              onChange={(event) =>
                                setSettingsPersona({ ...settingsPersona, workspace: event.target.value })
                              }
                              className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-[13px] text-foreground"
                            />
                          </label>
                          <label className="col-span-2 space-y-1.5 text-[11px] text-muted-foreground">
                            <span>Instructions</span>
                            <textarea
                              value={settingsBody}
                              onChange={(event) => setSettingsBody(event.target.value)}
                              className="min-h-[320px] w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground"
                            />
                          </label>
                        </div>
                      </div>
                    ) : null}

                    {activeSettingsTab === "stack" ? (
                      <AgentStackSettingsCard slug={settingsPersona.slug} />
                    ) : null}

                    {activeSettingsTab === "jobs" ? (
                      <AgentJobsEditor
                        jobs={settingsJobs}
                        selectedJobId={selectedJobId}
                        jobDraft={jobDraft}
                        onStartNewJobDraft={startNewJobDraft}
                        onOpenJob={openJob}
                        onRunJob={runJob}
                        onDeleteJob={deleteJob}
                        onSaveJob={saveJob}
                        onJobDraftChange={(job) => setJobDraft(job)}
                      />
                    ) : null}
                  </>
                ) : (
                  <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading settings...
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        ) : (
          <div className="flex h-full flex-col">
            <div className="border-b border-border px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-[15px] font-semibold">
                    {activeAgentSlug
                      ? `Start a new conversation with ${activeAgent?.name || activeAgentSlug}`
                      : "Choose an agent to start a conversation"}
                  </h3>
                  <p className="text-[11px] text-muted-foreground">
                    Use @mentions to bring KB files into context, just like the Claude editor.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1 text-xs"
                  onClick={() => {
                    if (activeAgentSlug) {
                      openAgentSettings(activeAgentSlug);
                    } else {
                      openAgentDirectory();
                    }
                  }}
                >
                  <Settings className="h-3.5 w-3.5" />
                  Settings
                </Button>
              </div>
            </div>
            <div className="flex flex-1 flex-col justify-center px-8 py-10">
              {!activeAgentSlug ? (
                <div className="mx-auto max-w-xl text-center">
                  <Bot className="mx-auto mb-4 h-10 w-10 text-muted-foreground/30" />
                  <p className="text-[14px] font-medium">Pick an agent from the left rail</p>
                  <p className="mt-2 text-[12px] text-muted-foreground">
                    The center column already shows the team timeline. Choose one agent on the left to start a focused session, or open Settings to manage the team.
                  </p>
                </div>
              ) : (
                <AgentsWorkspaceComposer
                  agentName={activeAgent?.name || activeAgentSlug}
                  allPages={allPages}
                  value={composerInput}
                  mentionedPaths={mentionedPaths}
                  submitting={submitting}
                  onValueChange={setComposerInput}
                  onMentionedPathsChange={setMentionedPaths}
                  onSubmit={submitConversation}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
