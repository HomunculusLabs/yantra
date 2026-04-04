"use client";

import { useState, useEffect, useCallback } from "react";
import { Gauge, Plus, RefreshCw, Zap, MessageSquare, Loader2, BookOpen, Power, Pause, PlayCircle, FolderOpen, Upload, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/stores/app-store";
import { useTreeStore } from "@/stores/tree-store";
import { useEditorStore } from "@/stores/editor-store";
import { PulseStrip } from "./pulse-strip";
import { DepartmentCard } from "./department-card";
import { AgentCard } from "./agent-card";
import { SlackPanel } from "./slack-panel";
import { CreateAgentDialog } from "./create-agent-dialog";
import { AgentDetailPanel } from "./agent-detail-panel";
import { GoalBar } from "./goal-bar";
import { WorkspaceGallery } from "./workspace-gallery";
import { useMissionControlData } from "./use-mission-control-data";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import type { AgentSummary } from "@/types/agent-api";
import type { MissionControlPulseMetrics } from "@/types/agents";

interface DepartmentGroup {
  name: string;
  agents: AgentSummary[];
}

export function MissionControl() {
  const [createOpen, setCreateOpen] = useState(false);
  const [nlOpen, setNlOpen] = useState(false);
  const [nlInput, setNlInput] = useState("");
  const [detailSlug, setDetailSlug] = useState<string | null>(null);
  const [showGoalSummary, setShowGoalSummary] = useState(false);
  const [confirmStart, setConfirmStart] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [gridExpanded, setGridExpanded] = useState(false);
  const setSection = useAppStore((s) => s.setSection);
  const selectPage = useTreeStore((s) => s.selectPage);
  const loadPage = useEditorStore((s) => s.loadPage);

  const openPath = useCallback((filePath: string) => {
    const normalized = filePath.startsWith("/data/")
      ? filePath.slice(6)
      : filePath.startsWith("data/")
        ? filePath.slice(5)
        : filePath.startsWith("/@runtime/")
          ? filePath.slice(1)
          : filePath;

    if (!normalized) return;
    setSection({ type: "page" });
    selectPage(normalized);
    loadPage(normalized);
  }, [loadPage, selectPage, setSection]);

  const {
    agents,
    alertCount,
    loading,
    nlGenerating,
    schedulerRunning,
    schedulerToggling,
    scheduledCount,
    companyName,
    loadAgents,
    runSchedulerAction,
    toggleAgent,
    runAgent,
    bulkToggleDepartment,
    createAgentFromDescription,
    importBundle,
  } = useMissionControlData();

  // Request browser notification permission on mount
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);


  // Listen for Cmd+N create agent shortcut
  useEffect(() => {
    const handler = () => setCreateOpen(true);
    window.addEventListener("yantra:create-agent", handler);
    return () => window.removeEventListener("yantra:create-agent", handler);
  }, []);

  // Escape key closes confirmation dialog
  useEffect(() => {
    if (!confirmStart) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirmStart(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [confirmStart]);

  // Group agents by department — "general" agents are standalone
  // Filter out system agents (Editor Agent) from Mission Control
  const mcAgents = agents.filter((a) => a.slug !== "editor");
  const departments: DepartmentGroup[] = [];
  const standaloneAgents: AgentSummary[] = [];
  const deptMap = new Map<string, AgentSummary[]>();
  for (const agent of mcAgents) {
    const dept = agent.department || "general";
    if (dept === "general") {
      standaloneAgents.push(agent);
    } else {
      if (!deptMap.has(dept)) deptMap.set(dept, []);
      deptMap.get(dept)!.push(agent);
    }
  }
  for (const [name, deptAgents] of deptMap) {
    departments.push({ name, agents: deptAgents });
  }
  departments.sort((a, b) => a.name.localeCompare(b.name));

  // Compute pulse metrics (exclude system agents like Editor)
  const allGoals = mcAgents.flatMap((a) => a.goals ?? []);
  const goalsWithData = allGoals.filter((g) => g.target > 0 && g.current > 0);
  const goalsOnTrack = goalsWithData.filter((g) => g.current / g.target >= 0.4).length;

  const pulseMetrics: MissionControlPulseMetrics = {
    totalAgents: mcAgents.length,
    activeAgents: mcAgents.filter((a) => a.active).length,
    runningPlays: mcAgents.filter((a) => a.running).length,
    playsThisWeek: 0,
    goalsOnTrack,
    totalGoals: goalsWithData.length > 0 ? goalsWithData.length : allGoals.length,
    alerts: alertCount,
    estimatedCost: 0,
  };

  const handleSchedulerToggle = async () => {
    if (!schedulerRunning && !confirmStart) {
      setConfirmStart(true);
      return;
    }
    setConfirmStart(false);
    await runSchedulerAction(schedulerRunning ? "stop-all" : "start-all");
  };

  const handleAgentToggle = async (slug: string) => {
    await toggleAgent(slug);
  };

  const handleAgentClick = (slug: string) => {
    setDetailSlug(slug);
  };

  const handleAgentRun = async (slug: string) => {
    await runAgent(slug);
  };

  const handleNlCreate = async () => {
    if (!nlInput.trim()) return;
    const created = await createAgentFromDescription(nlInput);
    if (created) {
      setNlOpen(false);
      setNlInput("");
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-2">
          <Gauge className="h-8 w-8 mx-auto text-muted-foreground/40 animate-pulse" />
          <p className="text-[13px] text-muted-foreground">
            Loading Mission Control...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 sm:px-4 py-2 sm:py-3 border-b border-border shrink-0 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Gauge className="h-5 w-5 text-primary shrink-0 hidden sm:block" />
          <div className="min-w-0">
            <h1 className="text-[14px] sm:text-[15px] font-semibold tracking-[-0.02em] truncate">
              {companyName ? `${companyName}` : "Yantra"}
            </h1>
            <p className="text-[10px] sm:text-[11px] text-muted-foreground/60 hidden sm:block">
              {companyName ? "Company OS" : "Your Company OS"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          <Button
            variant={schedulerRunning ? "default" : "outline"}
            size="sm"
            className={cn(
              "h-7 text-[12px] gap-1 sm:gap-1.5",
              schedulerRunning && "bg-emerald-600 hover:bg-emerald-700 text-white"
            )}
            onClick={handleSchedulerToggle}
            disabled={schedulerToggling}
          >
            {schedulerToggling ? (
              <RefreshCw className="h-3 w-3 animate-spin" />
            ) : schedulerRunning ? (
              <Pause className="h-3 w-3" />
            ) : (
              <PlayCircle className="h-3 w-3" />
            )}
            <span className="hidden sm:inline">
              {schedulerToggling
                ? "..."
                : schedulerRunning
                  ? `Running (${scheduledCount})`
                  : "Start Team"}
            </span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[12px] gap-1.5 hidden md:flex"
            onClick={() => void loadAgents()}
          >
            <RefreshCw className="h-3 w-3" />
            Refresh
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[12px] gap-1.5 hidden sm:flex"
            onClick={() => setShowGallery(!showGallery)}
          >
            <FolderOpen className="h-3 w-3" />
            <span className="hidden md:inline">Gallery</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[12px] gap-1.5 hidden sm:flex"
            onClick={() => setSection({ type: "jobs" })}
          >
            <BookOpen className="h-3 w-3" />
            <span className="hidden md:inline">Jobs</span>
          </Button>
          <Button
            variant="default"
            size="sm"
            className="h-7 text-[12px] gap-1 sm:gap-1.5"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-3 w-3" />
            <span className="hidden sm:inline">New Agent</span>
          </Button>
        </div>
      </div>

      {/* Pulse Strip */}
      <PulseStrip
        metrics={pulseMetrics}
        onAlertClick={() => {
          // Scroll to slack panel and switch to alerts channel
          window.dispatchEvent(new CustomEvent("yantra:switch-slack-channel", { detail: "alerts" }));
        }}
        onGoalClick={() => setShowGoalSummary(!showGoalSummary)}
        onPlaybookClick={() => setSection({ type: "jobs" })}
        onAgentClick={handleAgentClick}
      />

      {/* Goal Summary (toggle via pulse strip click) */}
      {showGoalSummary && (
        <div className="px-4 py-3 border-b border-border bg-muted/10 space-y-3 max-h-[200px] overflow-y-auto shrink-0">
          <div className="flex items-center justify-between">
            <h3 className="text-[12px] font-semibold text-muted-foreground">All Goals</h3>
            <button
              onClick={() => setShowGoalSummary(false)}
              className="text-[10px] text-muted-foreground/50 hover:text-foreground"
            >
              Close
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {mcAgents.filter((a) => (a.goals || []).length > 0).map((agent) => (
              <div key={agent.slug} className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <AgentAvatar name={agent.name} slug={agent.slug} size="xs" />
                  <span className="text-[11px] font-medium truncate">{agent.name}</span>
                </div>
                {(agent.goals || []).map((g) => (
                  <GoalBar
                    key={g.metric}
                    label={g.metric.replace(/_/g, " ")}
                    current={g.current}
                    target={g.target}
                    unit={g.unit}
                    floor={g.floor}
                    compact
                  />
                ))}
              </div>
            ))}
            {mcAgents.filter((a) => (a.goals || []).length > 0).length === 0 && (
              <p className="text-[11px] text-muted-foreground/50 col-span-full">No agents have goals configured.</p>
            )}
          </div>
        </div>
      )}

      {/* Main content area (agent grid + slack OR gallery) */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        {showGallery ? (
          <WorkspaceGallery onClose={() => setShowGallery(false)} />
        ) : (
        <>
        {/* Agent Grid */}
        <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
          {departments.length === 0 && standaloneAgents.length === 0 ? (
            <div className="text-center py-12 space-y-3">
              <Gauge className="h-12 w-12 mx-auto text-muted-foreground/20" />
              <div>
                <p className="text-[14px] font-medium text-muted-foreground">
                  No agents configured
                </p>
                <p className="text-[12px] text-muted-foreground/60">
                  Create your first agent to get started with Yantra Agents.
                </p>
              </div>
              <Button variant="default" size="sm" className="text-[12px] gap-1.5" onClick={() => setCreateOpen(true)}>
                <Plus className="h-3 w-3" />
                Create Agent
              </Button>
            </div>
          ) : (
            <>
            {/* Grid toolbar */}
            {departments.length >= 3 && (
              <div className="flex items-center justify-end mb-2">
                <button
                  onClick={() => setGridExpanded(!gridExpanded)}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-foreground transition-colors px-1.5 py-0.5 rounded-md hover:bg-muted/30"
                >
                  <ChevronsUpDown className="h-3 w-3" />
                  {gridExpanded ? "Collapse All" : "Expand All"}
                </button>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3 items-start">
              {departments.map((dept) => (
                <DepartmentCard
                  key={`${dept.name}-${gridExpanded ? "e" : "c"}`}
                  department={dept.name}
                  agents={dept.agents}
                  defaultCollapsed={!gridExpanded}
                  onAgentClick={handleAgentClick}
                  onAgentToggle={handleAgentToggle}
                  onAgentRun={handleAgentRun}
                  onBulkToggle={bulkToggleDepartment}
                  onViewWorkspace={(deptName) => {
                    // Find the lead agent for this department and navigate to its workspace
                    const lead = dept.agents.find((a) => a.type === "lead");
                    const slug = lead?.slug || dept.agents[0]?.slug;
                    if (slug) {
                      setSection({ type: "page" });
                      selectPage(`@runtime/.agents/${slug}/workspace`);
                    }
                  }}
                />
              ))}

              {/* Standalone agents (no department) as individual cards */}
              {standaloneAgents.map((agent) => (
                <div key={agent.slug} className="border border-border rounded-xl overflow-hidden bg-card p-2">
                  <AgentCard
                    {...agent}
                    type={agent.type || "specialist"}
                    goals={agent.goals || []}
                    onClick={() => handleAgentClick(agent.slug)}
                    onToggle={() => handleAgentToggle(agent.slug)}
                    onRun={() => handleAgentRun(agent.slug)}
                  />
                </div>
              ))}

              {/* Create Agent Card */}
              <div className="border border-dashed border-border/50 rounded-xl p-5 min-h-[120px] hover:border-primary/20 transition-colors">
                <div className="text-center space-y-3">
                  <Plus className="h-6 w-6 mx-auto text-muted-foreground/30" />
                  <p className="text-[14px] font-medium text-muted-foreground/70">
                    Create Agent
                  </p>
                  <div className="flex gap-2 justify-center">
                    <button
                      onClick={() => setCreateOpen(true)}
                      className="flex-1 max-w-[120px] py-2 px-3 rounded-lg border border-border/50 hover:border-primary/30 hover:bg-primary/[0.03] transition-colors text-center"
                    >
                      <Zap className="h-4 w-4 mx-auto mb-1 text-amber-500/60" />
                      <p className="text-[11px] font-medium text-muted-foreground">From Scratch</p>
                    </button>
                    <button
                      onClick={() => {
                        setNlInput("");
                        setNlOpen(true);
                      }}
                      className="flex-1 max-w-[120px] py-2 px-3 rounded-lg border border-border/50 hover:border-primary/30 hover:bg-primary/[0.03] transition-colors text-center"
                    >
                      <MessageSquare className="h-4 w-4 mx-auto mb-1 text-primary/60" />
                      <p className="text-[11px] font-medium text-muted-foreground">Describe It</p>
                    </button>
                    <button
                      onClick={() => {
                        const input = document.createElement("input");
                        input.type = "file";
                        input.accept = ".json";
                        input.onchange = async (e) => {
                          const file = (e.target as HTMLInputElement).files?.[0];
                          if (!file) return;
                          try {
                            const text = await file.text();
                            const bundle = JSON.parse(text);
                            await importBundle(bundle);
                          } catch { /* ignore */ }
                        };
                        input.click();
                      }}
                      className="flex-1 max-w-[120px] py-2 px-3 rounded-lg border border-border/50 hover:border-primary/30 hover:bg-primary/[0.03] transition-colors text-center"
                    >
                      <Upload className="h-4 w-4 mx-auto mb-1 text-cyan-500/60" />
                      <p className="text-[11px] font-medium text-muted-foreground">Import</p>
                    </button>
                  </div>
                </div>
              </div>
            </div>
            </>
          )}
        </div>

        {/* Agent Slack */}
        <SlackPanel
          height={220}
          onOpenFile={openPath}
        />
        </>
        )}
      </div>

      <CreateAgentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={loadAgents}
      />

      {/* Natural language agent creation dialog */}
      {nlOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/40" onClick={() => !nlGenerating && setNlOpen(false)} />
          <div className="relative bg-background border border-border rounded-xl shadow-2xl w-[440px] max-w-[90vw] p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div>
              <h2 className="text-[15px] font-semibold">Describe Your Agent</h2>
              <p className="text-[12px] text-muted-foreground/60 mt-1">
                Tell us what you need and we&apos;ll create the agent for you.
              </p>
            </div>
            <textarea
              value={nlInput}
              onChange={(e) => setNlInput(e.target.value)}
              placeholder="I need an agent that monitors Hacker News for GPU-related posts and writes thoughtful comments linking to our blog posts..."
              className="w-full h-28 text-[13px] bg-muted/30 border border-border/50 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40"
              disabled={nlGenerating}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleNlCreate();
                }
              }}
            />
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-muted-foreground/40">
                {nlGenerating ? "Generating agent..." : "Cmd+Enter to create"}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-[12px]"
                  onClick={() => setNlOpen(false)}
                  disabled={nlGenerating}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="text-[12px] gap-1.5"
                  onClick={handleNlCreate}
                  disabled={!nlInput.trim() || nlGenerating}
                >
                  {nlGenerating ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    "Create Agent"
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirm start dialog */}
      {confirmStart && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/40" onClick={() => setConfirmStart(false)} />
          <div className="relative bg-background border border-border rounded-xl shadow-2xl w-[380px] max-w-[90vw] p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div>
              <h2 className="text-[15px] font-semibold flex items-center gap-2">
                <PlayCircle className="h-4 w-4 text-emerald-500" />
                Start All Agents?
              </h2>
              <p className="text-[12px] text-muted-foreground/60 mt-2 leading-relaxed">
                This will activate <strong>{agents.filter((a) => !a.active).length} paused agents</strong> and schedule their heartbeats.
                Agents will begin running their configured CLI launchers on schedule.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" className="text-[12px]" onClick={() => setConfirmStart(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="text-[12px] gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={handleSchedulerToggle}
              >
                <Power className="h-3 w-3" />
                Start Team
              </Button>
            </div>
          </div>
        </div>
      )}

      {detailSlug && (
        <AgentDetailPanel
          slug={detailSlug}
          onClose={() => setDetailSlug(null)}
          onNavigateToAgent={(slug) => {
            setDetailSlug(null);
            setSection({ type: "agent", slug });
          }}
          onOpenFile={(filePath) => {
            setDetailSlug(null);
            openPath(filePath);
          }}
        />
      )}
    </div>
  );
}
