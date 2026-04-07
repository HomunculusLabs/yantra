"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Sidebar } from "@/components/sidebar/sidebar";
import { Header } from "@/components/layout/header";
import { KBEditor } from "@/components/editor/editor";
import { WebsiteViewer } from "@/components/editor/website-viewer";
import { PdfViewer } from "@/components/editor/pdf-viewer";
import { CsvViewer } from "@/components/editor/csv-viewer";
import { GraphView } from "@/components/graph/graph-view";
import { AgentsWorkspace } from "@/components/agents/agents-workspace";
import { JobsManager } from "@/components/jobs/jobs-manager";
import { SettingsPage } from "@/components/settings/settings-page";
import { PluginSurfaceHost } from "@/components/plugins/plugin-surface-host";
import { TerminalTabs } from "@/components/terminal/terminal-tabs";
import { AIPanel } from "@/components/ai-panel/ai-panel";
import { SearchDialog } from "@/components/search/search-dialog";
import { KeyboardShortcuts } from "@/components/shortcuts/keyboard-shortcuts";
import { StatusBar } from "@/components/layout/status-bar";
import { shouldRememberPreviousSection } from "@/components/layout/app-shell-state";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { useTreeStore } from "@/stores/tree-store";
import { useAppStore } from "@/stores/app-store";
import { useAIPanelStore } from "@/stores/ai-panel-store";

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

  const [showWizard, setShowWizard] = useState<boolean | null>(null);
  const previousSectionRef = useRef(section);

  useEffect(() => {
    void loadTree();
  }, [loadTree]);

  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/agents/events");
      es.addEventListener("tree_changed", () => {
        void loadTree();
      });
    } catch {
      // SSE not supported
    }
    return () => es?.close();
  }, [loadTree]);

  useEffect(() => {
    fetch("/api/agents/config")
      .then((response) => response.json())
      .then((data) => setShowWizard(!data.exists))
      .catch(() => setShowWizard(false));
  }, []);

  const handleWizardComplete = useCallback(() => {
    setShowWizard(false);
    setSection({ type: "agents" });
    void loadTree();
  }, [loadTree, setSection]);

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
    return <div className="flex h-screen bg-background" />;
  }

  if (showWizard) {
    return <OnboardingWizard onComplete={handleWizardComplete} />;
  }

  return (
    <div className="flex h-screen bg-background text-foreground">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <main className="min-h-0 flex-1 flex flex-col overflow-hidden">{renderContent()}</main>
        {terminalOpen && <TerminalTabs />}
        <StatusBar />
      </div>
      {!aiPanelCollapsed && <AIPanel />}
      <SearchDialog />
      <KeyboardShortcuts />
    </div>
  );
}
