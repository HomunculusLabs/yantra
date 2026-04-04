"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  ChevronDown,
  FileText,
  Loader2,
  Plus,
  Send,
  Settings,
  X,
  XCircle,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { WebTerminal } from "@/components/terminal/web-terminal";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { useAIPanelStore } from "@/stores/ai-panel-store";
import { useTreeStore } from "@/stores/tree-store";
import { useAppStore } from "@/stores/app-store";
import type { TreeNode } from "@/types";
import type { ConversationDetail, ConversationMeta } from "@/types/conversations";

interface AgentSummary {
  name: string;
  slug: string;
  emoji: string;
  role: string;
  active: boolean;
  runningCount?: number;
}

interface FlatPage {
  path: string;
  title: string;
}

type ViewFilter = "all" | "running" | "failed";

const GENERAL_AGENT: AgentSummary = {
  name: "General",
  slug: "general",
  emoji: "",
  role: "Manual Yantra assistant",
  active: true,
  runningCount: 0,
};

const TRIGGER_LABELS: Record<ConversationMeta["trigger"], string> = {
  manual: "Manual",
  job: "Job",
  heartbeat: "Heartbeat",
};

const TRIGGER_STYLES: Record<ConversationMeta["trigger"], string> = {
  manual: "bg-primary/10 text-primary",
  job: "bg-amber-500/10 text-amber-600",
  heartbeat: "bg-emerald-500/10 text-emerald-600",
};

function flattenTree(nodes: TreeNode[]): FlatPage[] {
  const result: FlatPage[] = [];
  for (const node of nodes) {
    if (node.type !== "website") {
      result.push({
        path: node.path,
        title: node.frontmatter?.title || node.name,
      });
    }
    if (node.children?.length) {
      result.push(...flattenTree(node.children));
    }
  }
  return result;
}

function formatRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function replacePastedTextNotice(output: string, displayPrompt?: string): string {
  if (!displayPrompt) return output;
  return output.replace(/\[Pasted text #\d+(?: \+\d+ lines)?\]/g, displayPrompt);
}

function makePageContextLabel(path: string, pages: FlatPage[]) {
  return pages.find((page) => page.path === path)?.title || path;
}

function filterConversations(
  conversations: ConversationMeta[],
  viewFilter: ViewFilter
) {
  if (viewFilter === "running") {
    return conversations.filter((conversation) => conversation.status === "running");
  }
  if (viewFilter === "failed") {
    return conversations.filter((conversation) => conversation.status === "failed");
  }
  return conversations;
}

function FilterChip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Button
      variant={active ? "secondary" : "ghost"}
      size="xs"
      className="h-6 rounded-full px-2"
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

export function AgentChatsPanel() {
  const close = useAIPanelStore((state) => state.close);
  const activeAgentSlug = useAIPanelStore((state) => state.activeAgentSlug);
  const setActiveAgentSlug = useAIPanelStore((state) => state.setActiveAgentSlug);
  const selectedConversationId = useAIPanelStore((state) => state.selectedConversationId);
  const setSelectedConversationId = useAIPanelStore(
    (state) => state.setSelectedConversationId
  );

  const treeNodes = useTreeStore((state) => state.nodes);
  const selectPage = useTreeStore((state) => state.selectPage);
  const setSection = useAppStore((state) => state.setSection);
  const section = useAppStore((state) => state.section);
  const setAgentSettingsReturnSection = useAppStore(
    (state) => state.setAgentSettingsReturnSection
  );

  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [selectedConversation, setSelectedConversation] =
    useState<ConversationDetail | null>(null);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [hasLoadedConversations, setHasLoadedConversations] = useState(false);
  const [viewFilter, setViewFilter] = useState<ViewFilter>("all");
  const [composerInput, setComposerInput] = useState("");
  const [mentionedPaths, setMentionedPaths] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionStartPos, setMentionStartPos] = useState(0);

  const allPages = useMemo(() => flattenTree(treeNodes), [treeNodes]);
  const filteredMentions = allPages.filter(
    (page) =>
      page.title.toLowerCase().includes(mentionQuery.toLowerCase()) ||
      page.path.toLowerCase().includes(mentionQuery.toLowerCase())
  );

  const refreshAgents = useCallback(async () => {
    const response = await fetch("/api/agents/personas");
    if (!response.ok) return;

    const data = await response.json();
    const personas = (data.personas || []) as AgentSummary[];
    const generalRunning =
      conversations.filter(
        (conversation) =>
          conversation.agentSlug === "general" && conversation.status === "running"
      ).length || 0;

    setAgents([
      { ...GENERAL_AGENT, runningCount: generalRunning },
      ...personas,
    ]);
  }, [conversations]);

  const refreshConversations = useCallback(async () => {
    if (!hasLoadedConversations) {
      setConversationsLoading(true);
    }

    const params = new URLSearchParams();
    if (activeAgentSlug) params.set("agent", activeAgentSlug);
    params.set("limit", "100");

    const response = await fetch(`/api/agents/conversations?${params.toString()}`);
    if (response.ok) {
      const data = await response.json();
      setConversations((data.conversations || []) as ConversationMeta[]);
    }

    setConversationsLoading(false);
    setHasLoadedConversations(true);
  }, [activeAgentSlug, hasLoadedConversations]);

  const refreshSelectedConversation = useCallback(async (conversationId: string) => {
    const response = await fetch(`/api/agents/conversations/${conversationId}`);
    if (!response.ok) return;
    const detail = (await response.json()) as ConversationDetail;
    setSelectedConversation(detail);
  }, []);

  useEffect(() => {
    setConversationsLoading(true);
    setHasLoadedConversations(false);
  }, [activeAgentSlug]);

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  useEffect(() => {
    void refreshAgents();
  }, [refreshAgents]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshConversations();
      void refreshAgents();
    }, 3000);
    return () => window.clearInterval(interval);
  }, [refreshAgents, refreshConversations]);

  useEffect(() => {
    if (!selectedConversationId) {
      setSelectedConversation(null);
      return;
    }

    const current = conversations.find(
      (conversation) => conversation.id === selectedConversationId
    );
    if (!current) {
      setSelectedConversation(null);
      return;
    }

    if (current.status !== "running") {
      void refreshSelectedConversation(selectedConversationId);
    }
  }, [conversations, refreshSelectedConversation, selectedConversationId]);

  const orderedAgents = useMemo(
    () =>
      [...agents].sort((a, b) => {
        if (a.slug === "general") return -1;
        if (b.slug === "general") return 1;
        if (a.slug === "editor") return -1;
        if (b.slug === "editor") return 1;
        return a.name.localeCompare(b.name);
      }),
    [agents]
  );

  const activeAgent = activeAgentSlug
    ? orderedAgents.find((agent) => agent.slug === activeAgentSlug) || null
    : null;
  const selectedConversationMeta = conversations.find(
    (conversation) => conversation.id === selectedConversationId
  );
  const visibleConversations = filterConversations(conversations, viewFilter);

  function handleComposerInput(value: string, cursorPosition: number) {
    setComposerInput(value);
    const textBefore = value.slice(0, cursorPosition);
    const atIndex = textBefore.lastIndexOf("@");
    if (atIndex === -1) {
      setShowMentions(false);
      return;
    }

    const charBefore = atIndex > 0 ? textBefore[atIndex - 1] : " ";
    if (charBefore !== " " && charBefore !== "\n" && atIndex !== 0) {
      setShowMentions(false);
      return;
    }

    const query = textBefore.slice(atIndex + 1);
    if (query.includes(" ") || query.includes("\n")) {
      setShowMentions(false);
      return;
    }

    setMentionStartPos(atIndex);
    setMentionQuery(query);
    setMentionIndex(0);
    setShowMentions(true);
  }

  function insertMention(path: string, title: string) {
    const before = composerInput.slice(0, mentionStartPos);
    const after = composerInput.slice(mentionStartPos + mentionQuery.length + 1);
    setComposerInput(`${before}@${title} ${after}`);
    setMentionedPaths((current) =>
      current.includes(path) ? current : [...current, path]
    );
    setShowMentions(false);
  }

  async function submitConversation() {
    if (!composerInput.trim() || !activeAgentSlug) return;

    setSubmitting(true);
    try {
      const response = await fetch("/api/agents/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentSlug: activeAgentSlug,
          userMessage: composerInput.trim(),
          mentionedPaths,
        }),
      });

      if (!response.ok) return;
      const data = await response.json();
      const conversation = data.conversation as ConversationMeta;
      setComposerInput("");
      setMentionedPaths([]);
      setSelectedConversationId(conversation.id);
      await refreshConversations();
    } finally {
      setSubmitting(false);
    }
  }

  function openAgentSettings(agentSlug: string) {
    if (section.view !== "settings") {
      setAgentSettingsReturnSection(section);
    }
    close();
    setSection({
      type: "agent",
      slug: agentSlug,
      view: "settings",
      settingsTarget: agentSlug,
    });
  }

  function openManageAgents() {
    if (section.view !== "settings") {
      setAgentSettingsReturnSection(section);
    }
    close();
    setSection({ type: "agents", view: "settings", settingsTarget: "directory" });
  }

  function openCreateAgent() {
    if (section.view !== "settings") {
      setAgentSettingsReturnSection(section);
    }
    close();
    setSection({ type: "agents", view: "settings", settingsTarget: "__new__" });
  }

  return (
    <>
      <div className="shrink-0 border-b border-border px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-2">
            {selectedConversationMeta ? (
              <Button
                variant="ghost"
                size="icon-sm"
                className="-ml-1"
                onClick={() => setSelectedConversationId(null)}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            ) : (
              <Bot className="h-4 w-4 shrink-0 text-primary" />
            )}
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold tracking-[-0.02em]">
                {selectedConversationMeta ? "Conversation" : "Agent Chats"}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {selectedConversationMeta
                  ? selectedConversationMeta.title
                  : activeAgent
                    ? activeAgent.name
                    : "Inbox across your team"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {selectedConversationMeta ? (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => openAgentSettings(selectedConversationMeta.agentSlug)}
                title="Open agent settings"
              >
                <Settings className="h-4 w-4" />
              </Button>
            ) : activeAgent ? (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => openAgentSettings(activeAgent.slug)}
                title="Open agent settings"
              >
                <Settings className="h-4 w-4" />
              </Button>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-[11px]"
                  onClick={openCreateAgent}
                  title="Create agent"
                >
                  <Plus data-icon="inline-start" className="h-3.5 w-3.5" />
                  New
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-[11px]"
                  onClick={openManageAgents}
                  title="Manage agents"
                >
                  <Settings data-icon="inline-start" className="h-3.5 w-3.5" />
                  Manage
                </Button>
              </>
            )}
            <Button variant="ghost" size="icon-sm" onClick={close}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {selectedConversationMeta ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-border px-3 py-3">
            <div className="flex items-start gap-3">
              <AgentAvatar
                name={orderedAgents.find((agent) => agent.slug === selectedConversationMeta.agentSlug)?.name}
                slug={selectedConversationMeta.agentSlug}
                size="md"
                className="mt-0.5"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px]",
                      TRIGGER_STYLES[selectedConversationMeta.trigger]
                    )}
                  >
                    {TRIGGER_LABELS[selectedConversationMeta.trigger]}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {selectedConversationMeta.status}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {formatRelative(selectedConversationMeta.startedAt)}
                  </span>
                </div>
                {selectedConversation?.artifacts?.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {selectedConversation.artifacts.map((artifact) => (
                      <button
                        key={artifact.path}
                        onClick={() => {
                          selectPage(artifact.path);
                          setSection({ type: "page" });
                        }}
                        className="rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {artifact.label || artifact.path}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            {selectedConversationMeta.status === "running" ? (
              <WebTerminal
                sessionId={selectedConversationMeta.id}
                displayPrompt={selectedConversationMeta.title}
                reconnect
                onClose={() => void refreshConversations()}
              />
            ) : selectedConversation ? (
              <ScrollArea className="h-full bg-card/70">
                <pre className="min-h-full whitespace-pre-wrap p-4 font-mono text-[12px] leading-relaxed text-foreground/85">
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
      ) : (
        <>
          <div className="shrink-0 border-b border-border px-3 py-3">
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "min-w-0 flex-1 justify-between px-3 text-[12px] font-normal"
                  )}
                >
                  <span className="truncate">
                    {activeAgent ? activeAgent.name : "All agents"}
                  </span>
                  <ChevronDown data-icon="inline-end" />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuGroup>
                    <DropdownMenuItem onClick={() => setActiveAgentSlug(null)}>
                      <span className="flex-1">All agents</span>
                      {!activeAgentSlug ? (
                        <span className="text-[10px] text-muted-foreground">Selected</span>
                      ) : null}
                    </DropdownMenuItem>
                    {orderedAgents.map((agent) => (
                      <DropdownMenuItem
                        key={agent.slug}
                        onClick={() => setActiveAgentSlug(agent.slug)}
                      >
                        <span className="flex items-center gap-2 truncate">
                          <AgentAvatar name={agent.name} slug={agent.slug} size="xs" />
                          <span className="truncate">{agent.name}</span>
                        </span>
                        {activeAgentSlug === agent.slug ? (
                          <span className="ml-auto text-[10px] text-muted-foreground">
                            Selected
                          </span>
                        ) : null}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="mt-2 flex items-center gap-1">
              <FilterChip active={viewFilter === "all"} onClick={() => setViewFilter("all")}>
                All
              </FilterChip>
              <FilterChip
                active={viewFilter === "running"}
                onClick={() => setViewFilter("running")}
              >
                Running
              </FilterChip>
              <FilterChip
                active={viewFilter === "failed"}
                onClick={() => setViewFilter("failed")}
              >
                Failed
              </FilterChip>
            </div>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-1 p-2">
              {conversationsLoading && visibleConversations.length > 0 ? (
                <div className="flex items-center gap-2 px-2 py-6 text-[12px] text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading conversations...
                </div>
              ) : !hasLoadedConversations && visibleConversations.length === 0 ? (
                <div className="px-2 py-8" />
              ) : visibleConversations.length === 0 ? (
                <div className="px-2 py-6 text-[12px] text-muted-foreground">
                  {activeAgent
                    ? `No conversations yet for ${activeAgent.name}.`
                    : "No conversations match this view."}
                </div>
              ) : (
                visibleConversations.map((conversation) => {
                  const agent =
                    orderedAgents.find((entry) => entry.slug === conversation.agentSlug) || null;
                  return (
                    <button
                      key={conversation.id}
                      onClick={() => setSelectedConversationId(conversation.id)}
                      className={cn(
                        "w-full rounded-lg border px-3 py-2.5 text-left transition-colors",
                        selectedConversationId === conversation.id
                          ? "border-primary/30 bg-primary/5"
                          : "border-border/80 hover:bg-accent/30"
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <div className="mt-0.5 shrink-0">
                          {conversation.status === "running" ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                          ) : conversation.status === "failed" ? (
                            <XCircle className="h-3.5 w-3.5 text-destructive" />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-[12px] font-medium text-foreground">
                              {conversation.title}
                            </p>
                            <span
                              className={cn(
                                "rounded-full px-1.5 py-0.5 text-[10px]",
                                TRIGGER_STYLES[conversation.trigger]
                              )}
                            >
                              {TRIGGER_LABELS[conversation.trigger]}
                            </span>
                          </div>
                          <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                            {agent?.name || conversation.agentSlug} ·{" "}
                            {formatRelative(conversation.startedAt)}
                          </p>
                          {conversation.summary ? (
                            <p className="mt-1 truncate text-[11px] text-muted-foreground/75">
                              {conversation.summary}
                            </p>
                          ) : null}
                          {conversation.artifactPaths.length > 0 ? (
                            <div className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground/70">
                              <FileText className="h-3 w-3" />
                              <span>
                                {conversation.artifactPaths.length} artifact
                                {conversation.artifactPaths.length === 1 ? "" : "s"}
                              </span>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </ScrollArea>

          {activeAgent ? (
            <div className="shrink-0 border-t border-border p-3">
              {mentionedPaths.length > 0 ? (
                <div className="mb-2 flex flex-wrap gap-1">
                  {mentionedPaths.map((path) => (
                    <button
                      key={path}
                      onClick={() =>
                        setMentionedPaths((current) =>
                          current.filter((entry) => entry !== path)
                        )
                      }
                      className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      @{makePageContextLabel(path, allPages)}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="relative rounded-xl border border-border bg-card px-3 py-2.5">
                {showMentions && filteredMentions.length > 0 ? (
                  <div className="absolute bottom-full left-0 right-0 z-10 mb-2 rounded-xl border border-border bg-popover p-1 shadow-lg">
                    {filteredMentions.slice(0, 6).map((page, index) => (
                      <button
                        key={page.path}
                        onClick={() => insertMention(page.path, page.title)}
                        className={cn(
                          "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[12px]",
                          index === mentionIndex
                            ? "bg-accent text-foreground"
                            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                        )}
                      >
                        <span className="truncate">{page.title}</span>
                        <span className="ml-3 truncate text-[11px] text-muted-foreground">
                          {page.path}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}

                <textarea
                  value={composerInput}
                  onChange={(event) =>
                    handleComposerInput(
                      event.target.value,
                      event.target.selectionStart || event.target.value.length
                    )
                  }
                  onKeyDown={(event) => {
                    if (showMentions && filteredMentions.length > 0) {
                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        setMentionIndex((current) =>
                          (current + 1) % filteredMentions.length
                        );
                      } else if (event.key === "ArrowUp") {
                        event.preventDefault();
                        setMentionIndex((current) =>
                          current === 0 ? filteredMentions.length - 1 : current - 1
                        );
                      } else if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        const page = filteredMentions[mentionIndex];
                        if (page) insertMention(page.path, page.title);
                      } else if (event.key === "Escape") {
                        setShowMentions(false);
                      }
                      return;
                    }

                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      void submitConversation();
                    }
                  }}
                  placeholder={`Ask ${activeAgent.name} to work on something...`}
                  className="min-h-[88px] w-full resize-none bg-transparent text-[13px] outline-none"
                />

                <div className="mt-2 flex items-center justify-between gap-3">
                  <p className="text-[10px] text-muted-foreground">
                    Use <span className="font-mono">@</span> to reference KB pages.
                  </p>
                  <Button
                    size="sm"
                    className="gap-2"
                    onClick={() => void submitConversation()}
                    disabled={submitting}
                  >
                    {submitting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    Start
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
