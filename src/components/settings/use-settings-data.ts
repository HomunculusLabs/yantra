"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  getIntegrationConfig,
  getLauncherRegistry,
  getLauncherValidationIssues,
  getRootsConfig,
  getRuntimeSettingsSummary,
  probeBrowserDaemonHealth,
  saveIntegrationConfig,
  saveLauncherRegistry,
  saveRootsConfig,
  sendTestNotification,
} from "@/lib/api/agents-client";
import type {
  BrowserDaemonStatus,
  DesktopDaemonInfo,
  IntegrationConfig,
  LauncherValidationIssue,
  NotificationTestResponse,
  RootsConfig,
  RuntimeSettingsSummary,
  SettingsTab,
} from "@/types/settings";

type UseSettingsDataResult = {
  runtimeSummary: RuntimeSettingsSummary | null;
  runtimeLoading: boolean;
  runtimeError: string | null;
  config: IntegrationConfig | null;
  roots: RootsConfig | null;
  configLoading: boolean;
  rootsLoading: boolean;
  launchersJson: string;
  launchersLoading: boolean;
  saving: boolean;
  saved: boolean;
  saveError: string | null;
  desktopDaemonInfo: DesktopDaemonInfo | null;
  browserDaemonStatus: BrowserDaemonStatus | null;
  restartingDaemon: boolean;
  restartingDaemonMode: "soft" | "force" | null;
  daemonActionError: string | null;
  launcherValidationIssues: LauncherValidationIssue[];
  revealedKeys: Set<string>;
  refreshAll: () => Promise<void>;
  saveCurrentTab: (tab: SettingsTab) => Promise<void>;
  resetFeedback: () => void;
  restartDaemon: (mode: "soft" | "force") => Promise<void>;
  requestNotificationTest: () => Promise<NotificationTestResponse>;
  toggleReveal: (key: string) => void;
  updateMcp: (id: string, field: string, value: unknown) => void;
  updateMcpEnv: (id: string, envKey: string, value: string) => void;
  updateNotif: (path: string, value: unknown) => void;
  updateScheduling: (field: string, value: unknown) => void;
  setRoots: Dispatch<SetStateAction<RootsConfig | null>>;
  setLaunchersJsonDraft: (value: string) => void;
};

export function useSettingsData(): UseSettingsDataResult {
  const [runtimeSummary, setRuntimeSummary] = useState<RuntimeSettingsSummary | null>(null);
  const [runtimeLoading, setRuntimeLoading] = useState(true);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [config, setConfig] = useState<IntegrationConfig | null>(null);
  const [roots, setRoots] = useState<RootsConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [rootsLoading, setRootsLoading] = useState(false);
  const [launchersJson, setLaunchersJson] = useState("");
  const [launchersLoading, setLaunchersLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [desktopDaemonInfo, setDesktopDaemonInfo] = useState<DesktopDaemonInfo | null>(null);
  const [browserDaemonStatus, setBrowserDaemonStatus] = useState<BrowserDaemonStatus | null>(null);
  const [restartingDaemon, setRestartingDaemon] = useState(false);
  const [restartingDaemonMode, setRestartingDaemonMode] = useState<"soft" | "force" | null>(null);
  const [daemonActionError, setDaemonActionError] = useState<string | null>(null);
  const [launcherValidationIssues, setLauncherValidationIssues] = useState<LauncherValidationIssue[]>([]);
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());

  const runtimeRequestRef = useRef(0);
  const configRequestRef = useRef(0);
  const rootsRequestRef = useRef(0);
  const launchersRequestRef = useRef(0);
  const desktopRequestRef = useRef(0);
  const savedTimeoutRef = useRef<number | null>(null);

  const clearSavedTimeout = useCallback(() => {
    if (savedTimeoutRef.current !== null) {
      window.clearTimeout(savedTimeoutRef.current);
      savedTimeoutRef.current = null;
    }
  }, []);

  const resetFeedback = useCallback(() => {
    clearSavedTimeout();
    setSaved(false);
    setSaveError(null);
    setLauncherValidationIssues([]);
    setDaemonActionError(null);
  }, [clearSavedTimeout]);

  const loadRuntime = useCallback(async () => {
    const requestId = ++runtimeRequestRef.current;
    setRuntimeLoading(true);
    setRuntimeError(null);
    try {
      const summary = await getRuntimeSettingsSummary();
      if (runtimeRequestRef.current !== requestId) return;
      setRuntimeSummary(summary);
    } catch (error) {
      if (runtimeRequestRef.current !== requestId) return;
      setRuntimeError(
        error instanceof Error ? error.message : "Failed to load runtime summary"
      );
    } finally {
      if (runtimeRequestRef.current === requestId) {
        setRuntimeLoading(false);
      }
    }
  }, []);

  const loadConfig = useCallback(async () => {
    const requestId = ++configRequestRef.current;
    setConfigLoading(true);
    try {
      const nextConfig = await getIntegrationConfig();
      if (configRequestRef.current !== requestId) return;
      setConfig(nextConfig);
    } catch {
      // preserve silent failure behavior
    } finally {
      if (configRequestRef.current === requestId) {
        setConfigLoading(false);
      }
    }
  }, []);

  const loadLaunchers = useCallback(async () => {
    const requestId = ++launchersRequestRef.current;
    setLaunchersLoading(true);
    try {
      const registry = await getLauncherRegistry();
      if (launchersRequestRef.current !== requestId) return;
      setLaunchersJson(JSON.stringify(registry, null, 2));
    } catch {
      // preserve silent failure behavior
    } finally {
      if (launchersRequestRef.current === requestId) {
        setLaunchersLoading(false);
      }
    }
  }, []);

  const loadRoots = useCallback(async () => {
    const requestId = ++rootsRequestRef.current;
    setRootsLoading(true);
    try {
      const nextRoots = await getRootsConfig();
      if (rootsRequestRef.current !== requestId) return;
      setRoots(nextRoots);
    } catch {
      // preserve silent failure behavior
    } finally {
      if (rootsRequestRef.current === requestId) {
        setRootsLoading(false);
      }
    }
  }, []);

  const loadDesktopDaemonInfo = useCallback(async () => {
    const requestId = ++desktopRequestRef.current;
    if (typeof window === "undefined" || !window.yantraDesktop?.getDaemonControlInfo) {
      if (desktopRequestRef.current !== requestId) return null;
      setDesktopDaemonInfo(null);
      setBrowserDaemonStatus(null);
      return null;
    }

    const info = await window.yantraDesktop.getDaemonControlInfo();
    const health = await probeBrowserDaemonHealth(info.healthUrl);
    if (desktopRequestRef.current !== requestId) return info;
    setDesktopDaemonInfo(info);
    setBrowserDaemonStatus(health);
    return info;
  }, []);

  const refreshAll = useCallback(async () => {
    resetFeedback();
    await Promise.allSettled([
      loadRuntime(),
      loadConfig(),
      loadLaunchers(),
      loadRoots(),
      loadDesktopDaemonInfo(),
    ]);
  }, [loadConfig, loadDesktopDaemonInfo, loadLaunchers, loadRoots, loadRuntime, resetFeedback]);

  const saveCurrentTab = useCallback(
    async (tab: SettingsTab) => {
      resetFeedback();
      setSaving(true);
      try {
        if (tab === "storage" && roots) {
          setRoots(
            await saveRootsConfig({
              vaultRoot: roots.vaultRoot,
              runtimeRoot: roots.runtimeRoot,
              storageRoutes: roots.storageRoutes,
            })
          );
        }

        if ((tab === "integrations" || tab === "notifications") && config) {
          await saveIntegrationConfig(config);
        }

        if (tab === "launchers") {
          let parsed: unknown;
          try {
            parsed = JSON.parse(launchersJson);
          } catch {
            setSaveError("Launcher registry must be valid JSON before saving.");
            return;
          }

          try {
            await saveLauncherRegistry(parsed);
          } catch (error) {
            const issues = getLauncherValidationIssues(error);
            setSaveError(
              error instanceof Error
                ? error.message
                : "Failed to save launcher registry."
            );
            setLauncherValidationIssues(issues);
            return;
          }

          await Promise.allSettled([loadLaunchers(), loadRuntime()]);
        }

        setSaved(true);
        clearSavedTimeout();
        savedTimeoutRef.current = window.setTimeout(() => setSaved(false), 2000);
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Failed to save settings");
      } finally {
        setSaving(false);
      }
    },
    [clearSavedTimeout, config, launchersJson, loadLaunchers, loadRuntime, resetFeedback, roots]
  );

  const restartDaemon = useCallback(async (mode: "soft" | "force") => {
    if (!window.yantraDesktop?.restartDaemon) {
      setDaemonActionError("Daemon restart is only available in the desktop app.");
      return;
    }

    setRestartingDaemon(true);
    setRestartingDaemonMode(mode);
    setDaemonActionError(null);
    try {
      await window.yantraDesktop.restartDaemon(mode);
      await Promise.allSettled([loadRuntime(), loadDesktopDaemonInfo()]);
    } catch (error) {
      setDaemonActionError(
        error instanceof Error ? error.message : `Failed to ${mode} restart daemon`
      );
    } finally {
      setRestartingDaemon(false);
      setRestartingDaemonMode(null);
    }
  }, [loadDesktopDaemonInfo, loadRuntime]);

  const requestNotificationTestAction = useCallback(async () => {
    return sendTestNotification();
  }, []);

  const toggleReveal = useCallback((key: string) => {
    setRevealedKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const updateMcp = useCallback((id: string, field: string, value: unknown) => {
    setConfig((previous) => {
      if (!previous) return previous;
      return {
        ...previous,
        mcp_servers: {
          ...previous.mcp_servers,
          [id]: { ...previous.mcp_servers[id], [field]: value },
        },
      };
    });
  }, []);

  const updateMcpEnv = useCallback((id: string, envKey: string, value: string) => {
    setConfig((previous) => {
      if (!previous) return previous;
      return {
        ...previous,
        mcp_servers: {
          ...previous.mcp_servers,
          [id]: {
            ...previous.mcp_servers[id],
            env: { ...previous.mcp_servers[id].env, [envKey]: value },
          },
        },
      };
    });
  }, []);

  const updateNotif = useCallback((path: string, value: unknown) => {
    setConfig((previous) => {
      if (!previous) return previous;
      const parts = path.split(".");
      const notifications = { ...previous.notifications } as Record<string, unknown>;
      if (parts.length === 1) {
        notifications[parts[0]] = value;
      } else {
        notifications[parts[0]] = {
          ...(notifications[parts[0]] as Record<string, unknown>),
          [parts[1]]: value,
        };
      }

      return {
        ...previous,
        notifications: notifications as IntegrationConfig["notifications"],
      };
    });
  }, []);

  const updateScheduling = useCallback((field: string, value: unknown) => {
    setConfig((previous) => {
      if (!previous) return previous;
      return {
        ...previous,
        scheduling: { ...previous.scheduling, [field]: value },
      };
    });
  }, []);

  const setLaunchersJsonDraft = useCallback((value: string) => {
    setLaunchersJson(value);
    setSaveError(null);
    setLauncherValidationIssues([]);
  }, []);

  useEffect(() => {
    void Promise.allSettled([
      loadRuntime(),
      loadConfig(),
      loadLaunchers(),
      loadRoots(),
      loadDesktopDaemonInfo(),
    ]);
  }, [loadConfig, loadDesktopDaemonInfo, loadLaunchers, loadRoots, loadRuntime]);

  useEffect(() => clearSavedTimeout, [clearSavedTimeout]);

  return {
    runtimeSummary,
    runtimeLoading,
    runtimeError,
    config,
    roots,
    configLoading,
    rootsLoading,
    launchersJson,
    launchersLoading,
    saving,
    saved,
    saveError,
    desktopDaemonInfo,
    browserDaemonStatus,
    restartingDaemon,
    restartingDaemonMode,
    daemonActionError,
    launcherValidationIssues,
    revealedKeys,
    refreshAll,
    saveCurrentTab,
    resetFeedback,
    restartDaemon,
    requestNotificationTest: requestNotificationTestAction,
    toggleReveal,
    updateMcp,
    updateMcpEnv,
    updateNotif,
    updateScheduling,
    setRoots,
    setLaunchersJsonDraft,
  };
}
