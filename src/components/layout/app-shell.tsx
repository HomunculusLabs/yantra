"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, useCallback } from "react";
import { Sidebar } from "@/components/sidebar/sidebar";
import { Header } from "@/components/layout/header";
import { KBEditor } from "@/components/editor/editor";
import { KeyboardShortcuts } from "@/components/shortcuts/keyboard-shortcuts";
import { StatusBar } from "@/components/layout/status-bar";
import { HashRouteSync } from "@/components/layout/hash-route-sync";
import { shouldRememberPreviousSection } from "@/components/layout/app-shell-state";
import { useTreeStore } from "@/stores/tree-store";
import { useAppStore } from "@/stores/app-store";
import { useAIPanelStore } from "@/stores/ai-panel-store";
import { useUIStore } from "@/stores/ui-store";

function SectionLoading() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-background text-sm text-muted-foreground">
      Loading…
    </div>
  );
}

const WebsiteViewer = dynamic(
  () => import("@/components/editor/website-viewer").then((mod) => mod.WebsiteViewer),
  { loading: SectionLoading }
);
const PdfViewer = dynamic(
  () => import("@/components/editor/pdf-viewer").then((mod) => mod.PdfViewer),
  { loading: SectionLoading }
);
const CsvViewer = dynamic(
  () => import("@/components/editor/csv-viewer").then((mod) => mod.CsvViewer),
  { loading: SectionLoading }
);
const GraphView = dynamic(
  () => import("@/components/graph/graph-view").then((mod) => mod.GraphView),
  { loading: SectionLoading }
);
const AgentsWorkspace = dynamic(
  () => import("@/components/agents/agents-workspace").then((mod) => mod.AgentsWorkspace),
  { loading: SectionLoading }
);
const JobsManager = dynamic(
  () => import("@/components/jobs/jobs-manager").then((mod) => mod.JobsManager),
  { loading: SectionLoading }
);
const SettingsPage = dynamic(
  () => import("@/components/settings/settings-page").then((mod) => mod.SettingsPage),
  { loading: SectionLoading }
);
const PluginSurfaceHost = dynamic(
  () => import("@/components/plugins/plugin-surface-host").then((mod) => mod.PluginSurfaceHost),
  { loading: SectionLoading }
);
const TerminalTabs = dynamic(
  () => import("@/components/terminal/terminal-tabs").then((mod) => mod.TerminalTabs),
  { loading: () => null }
);
const AIPanel = dynamic(
  () => import("@/components/ai-panel/ai-panel").then((mod) => mod.AIPanel),
  { loading: () => null }
);
const SearchDialog = dynamic(
  () => import("@/components/search/search-dialog").then((mod) => mod.SearchDialog),
  { loading: () => null }
);
const OnboardingWizard = dynamic(
  () => import("@/components/onboarding/onboarding-wizard").then((mod) => mod.OnboardingWizard),
  { loading: SectionLoading }
);

export function AppShell() {
  const loadTree = useTreeStore((s) => s.loadTree);
  const selectedPath = useTreeStore((s) => s.selectedPath);
  const selectedNode = useTreeStore((s) =>
    s.selectedPath ? s.nodeByPath[s.selectedPath] ?? null : null
  );
  const section = useAppStore((s) => s.section);
  const setSection = useAppStore((s) => s.setSection);
  const closePluginView = useAppStore((s) => s.closePluginView);
  const pluginReturnSection = useAppStore((s) => s.pluginReturnSection);
  const terminalOpen = useAppStore((s) => s.terminalOpen);
  const setSidebarCollapsed = useAppStore((s) => s.setSidebarCollapsed);
  const setAiPanelCollapsed = useAppStore((s) => s.setAiPanelCollapsed);
  const aiPanelCollapsed = useAppStore((s) => s.aiPanelCollapsed);
  const aiPanelOpen = useAIPanelStore((s) => s.isOpen);
  const openAgentPanel = useAIPanelStore((s) => s.openAgentPanel);
  const searchOpen = useUIStore((s) => s.activeDialog === "search");

  const [showWizard, setShowWizard] = useState<boolean | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);
  const previousSectionRef = useRef(section);

  useEffect(() => {
    if (showWizard !== false) return;
    void loadTree();
  }, [loadTree, showWizard]);

  useEffect(() => {
    if (showWizard !== false) return;

    let es: EventSource | null = null;
    try {
      es = new EventSource(`/api/tree/events?ts=${Date.now()}`);
      es.addEventListener("tree_changed", () => {
        void loadTree();
      });
    } catch {
      // SSE not supported
    }
    return () => es?.close();
  }, [loadTree, showWizard]);

  const loadStartupConfig = useCallback(async () => {
    setStartupError(null);
    setShowWizard(null);

    try {
      const response = await fetch("/api/agents/config", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Startup config request failed (${response.status})`);
      }
      const data = (await response.json()) as { exists?: boolean };
      setShowWizard(!data.exists);
    } catch (error) {
      setStartupError(
        error instanceof Error ? error.message : "Failed to load startup config"
      );
    }
  }, []);

  useEffect(() => {
    void loadStartupConfig();
  }, [loadStartupConfig]);

  const handleWizardComplete = useCallback(() => {
    setShowWizard(false);
    setSection({ type: "agents" });
  }, [setSection]);

  useEffect(() => {
    if (shouldRememberPreviousSection(section, pluginReturnSection)) {
      previousSectionRef.current = section;
    }
  }, [pluginReturnSection, section]);

  useEffect(() => {
    if (section.type === "agents" && section.view !== "settings") {
      setAiPanelCollapsed(false);
      openAgentPanel(null);
      return;
    }

    if (section.type === "agent" && section.view !== "settings") {
      setAiPanelCollapsed(false);
      openAgentPanel(section.slug || null);
    }
  }, [openAgentPanel, section, setAiPanelCollapsed]);

  const inferredType = !selectedNode && selectedPath
    ? selectedPath.endsWith(".csv")
      ? "csv"
      : selectedPath.endsWith(".pdf")
        ? "pdf"
        : null
    : null;
  const isWebsite = selectedNode?.type === "website";
  const isApp = selectedNode?.type === "app";
  const isPdf = selectedNode?.type === "pdf" || inferredType === "pdf";
  const isCsv = selectedNode?.type === "csv" || inferredType === "csv";

  const prevIsApp = useRef(false);
  useEffect(() => {
    if (isApp && !prevIsApp.current) {
      setSidebarCollapsed(true);
      setAiPanelCollapsed(true);
    }
    prevIsApp.current = Boolean(isApp);
  }, [isApp, setAiPanelCollapsed, setSidebarCollapsed]);

  const handleExitApp = () => {
    setSidebarCollapsed(false);
    setAiPanelCollapsed(false);
  };

  const renderContent = () => {
    if (section.type === "settings") {
      return (
        <SettingsPage
          initialTab={section.settingsTab}
          onExit={() => setSection(previousSectionRef.current || { type: "page" })}
        />
      );
    }
    if (section.type === "plugin" && section.pluginEntryKey && section.pluginViewId) {
      return (
        <PluginSurfaceHost
          entryKey={section.pluginEntryKey}
          viewId={section.pluginViewId}
          onBack={closePluginView}
        />
      );
    }
    if (section.type === "graph") return <GraphView />;
    if (section.type === "jobs") return <JobsManager />;
    if (section.type === "agent" && section.view === "settings") {
      return (
        <AgentsWorkspace
          selectedScope="agent"
          selectedAgentSlug={section.slug || null}
          initialMode="settings"
          initialSettingsTarget={section.settingsTarget || section.slug || null}
        />
      );
    }
    if (section.type === "agents" && section.view === "settings") {
      return (
        <AgentsWorkspace
          selectedScope="all"
          selectedAgentSlug={null}
          initialMode="settings"
          initialSettingsTarget={section.settingsTarget || "directory"}
        />
      );
    }
    if (section.type === "agents" && !aiPanelOpen) {
      return <AgentsWorkspace selectedScope="all" selectedAgentSlug={null} />;
    }
    if (section.type === "agent" && !aiPanelOpen) {
      return (
        <AgentsWorkspace
          selectedScope="agent"
          selectedAgentSlug={section.slug || null}
        />
      );
    }

    if (isApp && selectedNode) {
      return (
        <WebsiteViewer
          path={selectedNode.path}
          title={selectedNode.frontmatter?.title || selectedNode.name}
          fullscreen
          onExit={handleExitApp}
        />
      );
    }

    if (isCsv && (selectedNode || selectedPath)) {
      const csvPath = selectedNode?.path || selectedPath!;
      const csvTitle =
        selectedNode?.frontmatter?.title ||
        selectedNode?.name ||
        csvPath.split("/").pop() ||
        "CSV";
      return <CsvViewer path={csvPath} title={csvTitle} />;
    }

    if (isPdf && (selectedNode || selectedPath)) {
      const pdfPath = selectedNode?.path || selectedPath!;
      const pdfTitle =
        selectedNode?.frontmatter?.title ||
        selectedNode?.name ||
        pdfPath.split("/").pop() ||
        "PDF";
      return <PdfViewer path={pdfPath} title={pdfTitle} />;
    }

    if (isWebsite && selectedNode) {
      return (
        <WebsiteViewer
          path={selectedNode.path}
          title={selectedNode.frontmatter?.title || selectedNode.name}
        />
      );
    }

    return (
      <>
        <Header />
        <KBEditor />
      </>
    );
  };

  if (showWizard === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
          {startupError ? (
            <>
              <p className="text-sm font-semibold">Yantra is still starting</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {startupError}
              </p>
              <button
                type="button"
                onClick={() => void loadStartupConfig()}
                className="mt-4 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                Retry
              </button>
            </>
          ) : (
            <>
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
              <p className="mt-4 text-sm font-semibold">Starting Yantra…</p>
              <p className="mt-2 text-xs text-muted-foreground">
                Loading workspace configuration.
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  if (showWizard) {
    return <OnboardingWizard onComplete={handleWizardComplete} />;
  }

  return (
    <div className="flex h-screen bg-background text-foreground">
      <HashRouteSync />
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <main className="min-h-0 flex-1 flex flex-col overflow-hidden">{renderContent()}</main>
        {terminalOpen && <TerminalTabs />}
        <StatusBar />
      </div>
      {!aiPanelCollapsed && aiPanelOpen && <AIPanel />}
      {searchOpen && <SearchDialog />}
      <KeyboardShortcuts />
    </div>
  );
}
