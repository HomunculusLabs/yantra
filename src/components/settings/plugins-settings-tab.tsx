"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FolderPlus,
  Loader2,
  Puzzle,
  RefreshCw,
  Save,
  Shield,
  Trash2,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CURRENT_PLUGIN_CAPABILITY_PHASE, getPluginCapabilityDefinition, isPluginCapabilityAvailable } from "@/lib/plugins/plugin-capabilities";
import { getPluginCatalogEntryKey } from "@/lib/plugins/plugin-entry-key";
import { usePluginStore } from "@/stores/plugin-store";
import { useAppStore } from "@/stores/app-store";
import type { InstalledPluginSummary, PluginCapability, PluginManifest, PluginIssue } from "@/types/plugins";

function issueClasses(severity: PluginIssue["severity"]) {
  switch (severity) {
    case "error":
      return "border-red-500/30 bg-red-500/5 text-red-200";
    case "warning":
      return "border-amber-500/30 bg-amber-500/5 text-amber-100";
    default:
      return "border-blue-500/30 bg-blue-500/5 text-blue-100";
  }
}

function statusClasses(status: InstalledPluginSummary["status"]) {
  switch (status) {
    case "enabled":
      return "bg-emerald-500/10 text-emerald-400";
    case "needs_review":
      return "bg-amber-500/10 text-amber-300";
    case "error":
      return "bg-red-500/10 text-red-300";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function pluginLabel(plugin: InstalledPluginSummary): string {
  return (
    plugin.manifest?.name ?? plugin.manifest?.id ?? plugin.source.pluginPath.split("/").filter(Boolean).pop() ?? "Unknown plugin"
  );
}

function getBlockingIssues(plugin: InstalledPluginSummary): PluginIssue[] {
  return plugin.issues.filter((issue) => issue.severity === "error");
}

function getSettingsFields(plugin: InstalledPluginSummary & { manifest: PluginManifest }) {
  return plugin.manifest.settings?.schema?.fields ?? [];
}

export function PluginsSettingsTab() {
  const catalog = usePluginStore((state) => state.catalog);
  const catalogByEntryKey = usePluginStore((state) => state.catalogByEntryKey);
  const selectedPluginKey = usePluginStore((state) => state.selectedPluginKey);
  const loading = usePluginStore((state) => state.loading);
  const error = usePluginStore((state) => state.error);
  const catalogOperation = usePluginStore((state) => state.catalogOperation);
  const pendingOperationByEntryKey = usePluginStore((state) => state.pendingOperationByEntryKey);
  const mutationErrorByEntryKey = usePluginStore((state) => state.mutationErrorByEntryKey);
  const settingsDraftByEntryKey = usePluginStore((state) => state.settingsDraftByEntryKey);
  const loadCatalog = usePluginStore((state) => state.loadCatalog);
  const selectPlugin = usePluginStore((state) => state.selectPlugin);
  const installLocalPlugin = usePluginStore((state) => state.installLocalPlugin);
  const uninstallLocalPlugin = usePluginStore((state) => state.uninstallLocalPlugin);
  const approveManifest = usePluginStore((state) => state.approveManifest);
  const setEnabled = usePluginStore((state) => state.setEnabled);
  const saveGrantedCapabilities = usePluginStore((state) => state.saveGrantedCapabilities);
  const loadSettingsDraft = usePluginStore((state) => state.loadSettingsDraft);
  const updateSetting = usePluginStore((state) => state.updateSetting);
  const resetSettingsDraft = usePluginStore((state) => state.resetSettingsDraft);
  const saveSettings = usePluginStore((state) => state.saveSettings);
  const openPluginView = useAppStore((state) => state.openPluginView);

  const selectedPlugin = selectedPluginKey ? catalogByEntryKey[selectedPluginKey] ?? null : null;
  const [grantedDraft, setGrantedDraft] = useState<Set<PluginCapability>>(new Set());
  const hasDesktopPluginInstall =
    typeof window !== "undefined" && Boolean(window.yantraDesktop?.installPluginFromDirectory);
  const hasDesktopPluginUninstall =
    typeof window !== "undefined" && Boolean(window.yantraDesktop?.uninstallPlugin);

  useEffect(() => {
    if (catalog.length === 0 && !loading) {
      void loadCatalog();
    }
  }, [catalog.length, loadCatalog, loading]);

  useEffect(() => {
    if (!selectedPluginKey && catalog[0]) {
      selectPlugin(getPluginCatalogEntryKey(catalog[0]));
    }
  }, [catalog, selectPlugin, selectedPluginKey]);

  useEffect(() => {
    if (!selectedPlugin?.manifest) {
      setGrantedDraft(new Set());
      return;
    }
    setGrantedDraft(new Set(selectedPlugin.state.grantedCapabilities));
  }, [selectedPlugin?.manifestHash, selectedPlugin?.state.grantedCapabilities, selectedPlugin?.manifest]);

  useEffect(() => {
    if (!selectedPluginKey || !selectedPlugin?.manifest) return;
    if (selectedPlugin.issues.some((issue) => issue.code === "duplicate_plugin_id")) return;
    if (getBlockingIssues(selectedPlugin).some((issue) => issue.code !== "missing_required_capabilities")) return;
    if ((selectedPlugin.manifest.settings?.schema?.fields?.length ?? 0) === 0) return;
    void loadSettingsDraft(selectedPluginKey);
  }, [loadSettingsDraft, selectedPlugin?.issues, selectedPlugin?.manifest, selectedPlugin?.manifestHash, selectedPluginKey]);

  const draft = selectedPluginKey ? settingsDraftByEntryKey[selectedPluginKey] : undefined;
  const requestedRequired = selectedPlugin?.manifest?.requestedCapabilities.required ?? [];
  const requestedOptional = selectedPlugin?.manifest?.requestedCapabilities.optional ?? [];
  const pendingOperation = selectedPluginKey ? pendingOperationByEntryKey[selectedPluginKey] : null;
  const mutationError = selectedPluginKey ? mutationErrorByEntryKey[selectedPluginKey] : null;
  const blockingIssues = selectedPlugin ? getBlockingIssues(selectedPlugin) : [];
  const hasDuplicateIdIssue = Boolean(selectedPlugin?.issues.some((issue) => issue.code === "duplicate_plugin_id"));
  const hasMissingRequiredCapabilitiesIssue = Boolean(
    selectedPlugin?.issues.some((issue) => issue.code === "missing_required_capabilities")
  );
  const hasNonGrantBlockingIssues = blockingIssues.some(
    (issue) => issue.code !== "missing_required_capabilities"
  );
  const canApproveManifest = Boolean(
    selectedPlugin?.manifest &&
      !pendingOperation &&
      !hasNonGrantBlockingIssues &&
      selectedPlugin.state.approvedManifestHash !== selectedPlugin.manifestHash
  );
  const canToggleEnabled = Boolean(
    selectedPlugin?.manifest &&
      !pendingOperation &&
      !hasDuplicateIdIssue &&
      (selectedPlugin.state.enabled ||
        (selectedPlugin.status !== "needs_review" && !hasMissingRequiredCapabilitiesIssue && !hasNonGrantBlockingIssues))
  );
  const canOpenViews = Boolean(
    selectedPlugin?.manifest &&
      selectedPluginKey &&
      selectedPlugin.status === "enabled" &&
      !hasDuplicateIdIssue &&
      (selectedPlugin.manifest.views?.length ?? 0) > 0
  );
  const canInstallLocal = hasDesktopPluginInstall && !loading && catalogOperation !== "install";
  const canUninstallLocal = Boolean(
    selectedPluginKey &&
      selectedPlugin?.source.kind === "local-install" &&
      hasDesktopPluginUninstall &&
      !pendingOperation &&
      catalogOperation !== "install"
  );
  const settingsDirty = Boolean(
    draft &&
      Object.keys({ ...draft.rawValues, ...draft.savedRawValues }).some(
        (key) => draft.rawValues[key] !== draft.savedRawValues[key]
      )
  );

  const capabilitySections = useMemo(
    () => [
      { label: "Required capabilities", values: requestedRequired, required: true },
      { label: "Optional capabilities", values: requestedOptional, required: false },
    ].filter((section) => section.values.length > 0),
    [requestedOptional, requestedRequired]
  );

  if (loading && catalog.length === 0) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading plugins...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
        <div>
          <h3 className="text-[14px] font-semibold">Plugins</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Review manifests, approve them, manage capability grants, install local desktop copies,
            and edit schema-backed settings.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasDesktopPluginInstall ? (
            <Button
              variant="default"
              size="sm"
              className="h-8 gap-1.5 text-[12px]"
              onClick={() => void installLocalPlugin()}
              disabled={!canInstallLocal}
            >
              {catalogOperation === "install" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FolderPlus className="h-3.5 w-3.5" />
              )}
              Install from folder
            </Button>
          ) : null}
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-[12px]" onClick={() => void loadCatalog()}>
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh plugins
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-[12px] text-red-200">
          {error}
        </div>
      ) : null}

      <div className="grid min-h-[620px] gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-2 rounded-lg border border-border bg-card p-3">
          {catalog.length === 0 ? (
            <p className="px-2 py-3 text-[12px] text-muted-foreground">
              No plugins discovered yet. Add a plugin package to the configured vault plugin
              folder or the local install directory.
            </p>
          ) : (
            catalog.map((plugin) => {
              const entryKey = getPluginCatalogEntryKey(plugin);
              const isSelected = selectedPluginKey === entryKey;
              const highestSeverity = plugin.issues.find((issue) => issue.severity === "error")
                ? "error"
                : plugin.issues.find((issue) => issue.severity === "warning")
                  ? "warning"
                  : plugin.issues.length > 0
                    ? "info"
                    : null;

              return (
                <button
                  key={entryKey}
                  type="button"
                  onClick={() => selectPlugin(entryKey)}
                  className={cn(
                    "w-full rounded-lg border px-3 py-3 text-left transition-colors",
                    isSelected
                      ? "border-primary/40 bg-primary/5"
                      : "border-border bg-background hover:bg-accent/30"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-foreground">
                        {pluginLabel(plugin)}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {plugin.manifest?.id ?? "invalid-manifest"}
                      </p>
                    </div>
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", statusClasses(plugin.status))}>
                      {plugin.status.replace(/_/g, " ")}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                    <span>{plugin.source.kind}</span>
                    {plugin.manifest?.version ? <span>v{plugin.manifest.version}</span> : null}
                    {highestSeverity ? <span>issues: {highestSeverity}</span> : <span>no issues</span>}
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          {!selectedPlugin ? (
            <div className="flex h-full min-h-[400px] items-center justify-center text-[12px] text-muted-foreground">
              Select a plugin to inspect it.
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Puzzle className="h-4 w-4 text-primary" />
                    <h3 className="text-[15px] font-semibold text-foreground">{pluginLabel(selectedPlugin)}</h3>
                  </div>
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    {selectedPlugin.manifest?.id ?? "Invalid manifest"}
                    {selectedPlugin.manifest?.version ? ` · v${selectedPlugin.manifest.version}` : ""}
                    {selectedPlugin.manifest?.kind ? ` · ${selectedPlugin.manifest.kind}` : ""}
                  </p>
                  <p className="mt-1 break-all text-[11px] text-muted-foreground">
                    {selectedPlugin.source.kind} · {selectedPlugin.source.pluginPath}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn("rounded-full px-2 py-1 text-[10px] font-medium", statusClasses(selectedPlugin.status))}>
                    {selectedPlugin.status.replace(/_/g, " ")}
                  </span>
                  <span className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">
                    {selectedPlugin.state.approvedManifestHash === selectedPlugin.manifestHash ? "approved" : "review required"}
                  </span>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-background p-3 text-[12px] text-muted-foreground">
                <div className="flex items-start gap-2">
                  {selectedPlugin.status === "error" ? (
                    <XCircle className="mt-0.5 h-4 w-4 text-red-400" />
                  ) : selectedPlugin.status === "needs_review" ? (
                    <TriangleAlert className="mt-0.5 h-4 w-4 text-amber-300" />
                  ) : (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-400" />
                  )}
                  <div>
                    <p className="font-medium text-foreground">
                      {selectedPlugin.status === "needs_review"
                        ? "Manifest approval required before enabling"
                        : selectedPlugin.status === "error"
                          ? "Plugin has blocking validation issues"
                          : selectedPlugin.status === "enabled"
                            ? "Plugin is enabled"
                            : "Plugin is currently disabled"}
                    </p>
                    <p className="mt-1">
                      Trust stays sandboxed in phase 1. No runtime execution surface is exposed from this tab yet.
                    </p>
                  </div>
                </div>
              </div>

              {mutationError ? (
                <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-[12px] text-red-200">
                  {mutationError}
                </div>
              ) : null}

              <div className="space-y-2">
                <h4 className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Issues
                </h4>
                {selectedPlugin.issues.length === 0 ? (
                  <div className="rounded-lg border border-border bg-background px-3 py-2 text-[12px] text-muted-foreground">
                    No issues reported.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {selectedPlugin.issues.map((issue) => (
                      <div
                        key={`${issue.code}-${issue.message}`}
                        className={cn("rounded-lg border px-3 py-2 text-[12px]", issueClasses(issue.severity))}
                      >
                        <p className="font-medium">{issue.code}</p>
                        <p className="mt-1 text-muted-foreground">{issue.message}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {selectedPlugin.source.kind === "local-install" && hasDesktopPluginUninstall ? (
                <div className="rounded-lg border border-border bg-background p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h4 className="text-[13px] font-semibold text-foreground">Local install</h4>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Remove only the desktop-installed copy. Manifest approvals and saved settings may remain for reinstall.
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1.5 text-[12px] text-red-200"
                      onClick={() => {
                        if (!selectedPluginKey || !canUninstallLocal) return;
                        const confirmed = window.confirm(
                          `Remove the local install for ${pluginLabel(selectedPlugin)}? This only deletes the desktop-installed copy from the local plugin folder.`
                        );
                        if (!confirmed) return;
                        void uninstallLocalPlugin(selectedPluginKey);
                      }}
                      disabled={!canUninstallLocal}
                    >
                      {pendingOperation === "uninstall" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                      Uninstall local copy
                    </Button>
                  </div>
                </div>
              ) : null}

              {selectedPlugin.manifest ? (
                <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
                  <div className="space-y-4">
                    <div className="rounded-lg border border-border bg-background p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h4 className="text-[13px] font-semibold text-foreground">Actions</h4>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            Approve, enable, and grant requested capabilities through the server APIs.
                          </p>
                        </div>
                        <div className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">
                          manifest hash: {selectedPlugin.manifestHash?.slice(0, 12) ?? "n/a"}
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          className="h-8 gap-1.5 text-[12px]"
                          onClick={() => selectedPluginKey && void approveManifest(selectedPluginKey)}
                          disabled={!canApproveManifest}
                        >
                          {pendingOperation === "approve" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Shield className="h-3.5 w-3.5" />}
                          {selectedPlugin.state.approvedManifestHash === selectedPlugin.manifestHash ? "Approved" : "Approve manifest"}
                        </Button>

                        <Button
                          size="sm"
                          variant={selectedPlugin.state.enabled ? "outline" : "default"}
                          className="h-8 gap-1.5 text-[12px]"
                          onClick={() => selectedPluginKey && void setEnabled(selectedPluginKey, !selectedPlugin.state.enabled)}
                          disabled={!canToggleEnabled}
                        >
                          {pendingOperation === "enable" || pendingOperation === "disable" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                          {selectedPlugin.state.enabled ? "Disable" : "Enable"}
                        </Button>

                        {(selectedPlugin.manifest.views ?? []).map((view) => (
                          <Button
                            key={view.id}
                            size="sm"
                            variant="outline"
                            className="h-8 gap-1.5 text-[12px]"
                            onClick={() =>
                              selectedPluginKey &&
                              openPluginView({
                                entryKey: selectedPluginKey,
                                viewId: view.id,
                                returnSection: { type: "settings", settingsTab: "plugins" },
                              })
                            }
                            disabled={!canOpenViews}
                          >
                            <Puzzle className="h-3.5 w-3.5" />
                            {(selectedPlugin.manifest?.views?.length ?? 0) === 1 ? "Open workspace view" : `Open ${view.title}`}
                          </Button>
                        ))}
                      </div>

                      <div className="mt-4 rounded-lg border border-border/70 bg-card px-3 py-2 text-[11px] text-muted-foreground">
                        Trust is read-only in phase 1. The backend only permits sandboxed plugins here.
                      </div>
                    </div>

                    <div className="rounded-lg border border-border bg-background p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h4 className="text-[13px] font-semibold text-foreground">Capability grants</h4>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            Only requested, phase-1-supported sandbox capabilities can be granted.
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1.5 text-[12px]"
                          onClick={() => selectedPluginKey && void saveGrantedCapabilities(selectedPluginKey, [...grantedDraft])}
                          disabled={!selectedPlugin.manifest || Boolean(pendingOperation) || hasDuplicateIdIssue || hasNonGrantBlockingIssues}
                        >
                          {pendingOperation === "save_grants" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                          Save grants
                        </Button>
                      </div>

                      <div className="mt-4 space-y-4">
                        {capabilitySections.length === 0 ? (
                          <p className="text-[12px] text-muted-foreground">This plugin does not request any capabilities.</p>
                        ) : (
                          capabilitySections.map((section) => (
                            <div key={section.label} className="space-y-2">
                              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                {section.label}
                              </p>
                              <div className="space-y-2">
                                {section.values.map((capability) => {
                                  const definition = getPluginCapabilityDefinition(capability);
                                  const supported = isPluginCapabilityAvailable(capability, CURRENT_PLUGIN_CAPABILITY_PHASE) && definition.requiresTrust === "sandboxed";
                                  const checked = grantedDraft.has(capability);
                                  return (
                                    <label key={capability} className="flex items-start gap-3 rounded-lg border border-border/70 bg-card px-3 py-2 text-[12px]">
                                      <input
                                        type="checkbox"
                                        className="mt-0.5"
                                        checked={checked}
                                        disabled={!supported || Boolean(pendingOperation) || hasDuplicateIdIssue}
                                        onChange={(event) => {
                                          setGrantedDraft((current) => {
                                            const next = new Set(current);
                                            if (event.target.checked) next.add(capability);
                                            else next.delete(capability);
                                            return next;
                                          });
                                        }}
                                      />
                                      <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <span className="font-medium text-foreground">{definition.label}</span>
                                          {section.required ? <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300">required</span> : null}
                                          {!supported ? <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] text-red-300">not grantable in phase 1</span> : null}
                                        </div>
                                        <p className="mt-1 text-muted-foreground">{definition.description}</p>
                                      </div>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-lg border border-border bg-background p-4">
                      <h4 className="text-[13px] font-semibold text-foreground">Settings</h4>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Schema-backed settings are loaded lazily and saved as a full replacement payload.
                      </p>

                      {!selectedPlugin.manifest.settings?.schema?.fields?.length ? (
                        <p className="mt-4 text-[12px] text-muted-foreground">This plugin does not declare any editable settings.</p>
                      ) : draft?.status === "loading" ? (
                        <div className="mt-4 flex items-center gap-2 text-[12px] text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Loading settings…
                        </div>
                      ) : draft ? (
                        <div className="mt-4 space-y-3">
                          {draft.submitError ? (
                            <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-[12px] text-red-200">
                              {draft.submitError}
                            </div>
                          ) : null}

                          {draft.validationIssues.length > 0 ? (
                            <div className="space-y-2">
                              {draft.validationIssues.map((issue) => (
                                <div key={`${issue.code}-${issue.message}`} className={cn("rounded-lg border px-3 py-2 text-[12px]", issueClasses(issue.severity))}>
                                  <p className="font-medium">{issue.code}</p>
                                  <p className="mt-1 text-muted-foreground">{issue.message}</p>
                                </div>
                              ))}
                            </div>
                          ) : null}

                          {getSettingsFields(selectedPlugin as InstalledPluginSummary & { manifest: PluginManifest }).map((field) => {
                            const value = draft.rawValues[field.key] ?? (field.type === "boolean" ? false : "");
                            return (
                              <label key={field.key} className="block space-y-1.5">
                                <div>
                                  <p className="text-[12px] font-medium text-foreground">{field.label}</p>
                                  {field.description ? <p className="text-[11px] text-muted-foreground">{field.description}</p> : null}
                                </div>
                                {field.type === "textarea" ? (
                                  <textarea
                                    value={typeof value === "string" ? value : ""}
                                    onChange={(event) => selectedPluginKey && updateSetting(selectedPluginKey, field.key, event.target.value)}
                                    disabled={Boolean(pendingOperation) || hasDuplicateIdIssue || hasNonGrantBlockingIssues}
                                    className="min-h-24 w-full rounded-lg border border-border bg-card px-3 py-2 text-[13px] text-foreground"
                                  />
                                ) : field.type === "boolean" ? (
                                  <label className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-[13px] text-foreground">
                                    <input
                                      type="checkbox"
                                      checked={Boolean(value)}
                                      onChange={(event) => selectedPluginKey && updateSetting(selectedPluginKey, field.key, event.target.checked)}
                                      disabled={Boolean(pendingOperation) || hasDuplicateIdIssue || hasNonGrantBlockingIssues}
                                    />
                                    <span>Enabled</span>
                                  </label>
                                ) : field.type === "select" ? (
                                  <select
                                    value={typeof value === "string" ? value : ""}
                                    onChange={(event) => selectedPluginKey && updateSetting(selectedPluginKey, field.key, event.target.value)}
                                    disabled={Boolean(pendingOperation) || hasDuplicateIdIssue || hasNonGrantBlockingIssues}
                                    className="w-full rounded-lg border border-border bg-card px-3 py-2 text-[13px] text-foreground"
                                  >
                                    {field.options?.map((option) => (
                                      <option key={option.value} value={option.value}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <input
                                    type={field.type === "number" ? "text" : "text"}
                                    value={typeof value === "string" ? value : ""}
                                    onChange={(event) => selectedPluginKey && updateSetting(selectedPluginKey, field.key, event.target.value)}
                                    disabled={Boolean(pendingOperation) || hasDuplicateIdIssue || hasNonGrantBlockingIssues}
                                    className="w-full rounded-lg border border-border bg-card px-3 py-2 text-[13px] text-foreground"
                                  />
                                )}
                                {draft.fieldErrors[field.key] ? (
                                  <p className="text-[11px] text-red-300">{draft.fieldErrors[field.key]}</p>
                                ) : null}
                              </label>
                            );
                          })}

                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              className="h-8 gap-1.5 text-[12px]"
                              onClick={() => selectedPluginKey && void saveSettings(selectedPluginKey)}
                              disabled={Boolean(pendingOperation) || hasDuplicateIdIssue || hasNonGrantBlockingIssues || !settingsDirty}
                            >
                              {pendingOperation === "save_settings" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                              Save settings
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 text-[12px]"
                              onClick={() => selectedPluginKey && resetSettingsDraft(selectedPluginKey)}
                              disabled={Boolean(pendingOperation) || !settingsDirty}
                            >
                              Reset
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-4 flex items-center gap-2 text-[12px] text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Preparing settings…
                        </div>
                      )}
                    </div>

                    <div className="rounded-lg border border-border bg-background p-4 text-[12px] text-muted-foreground">
                      <div className="flex items-start gap-2">
                        <Shield className="mt-0.5 h-4 w-4 text-primary" />
                        <div>
                          <p className="font-medium text-foreground">Phase-1 safety rules</p>
                          <p className="mt-1">
                            Plugins stay sandboxed, can only receive supported requested capabilities,
                            and cannot run directly from this settings surface yet.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-[12px] text-red-200">
                  This plugin could not be parsed. Fix its manifest before it can be managed here.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
