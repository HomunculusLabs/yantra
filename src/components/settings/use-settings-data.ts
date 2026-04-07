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
  getKeybindingValidationIssues,
  getKeybindingsConfig,
  getLauncherRegistry,
  getLauncherValidationIssues,
  getRootsConfig,
  getRuntimeSettingsSummary,
  getThemeValidationIssues,
  getThemesConfig,
  probeBrowserDaemonHealth,
  saveIntegrationConfig,
  saveKeybindingsConfig,
  saveLauncherRegistry,
  saveRootsConfig,
  saveThemesConfig,
  sendTestNotification,
} from "@/lib/api/agents-client";
import { useThemeCatalog } from "@/components/theme-provider";
import type {
  BrowserDaemonStatus,
  DesktopDaemonInfo,
  IntegrationConfig,
  KeybindingValidationIssue,
  KeybindingsConfigResponse,
  LauncherValidationIssue,
  NotificationTestResponse,
  RootsConfig,
  RuntimeSettingsSummary,
  SettingsTab,
  ThemeValidationIssue,
  ThemesConfigResponse,
} from "@/types/settings";
import type {
  LauncherCatalogEntry,
  LauncherOverlayIssue,
  LauncherRegistryConfig,
} from "@/types/launchers";

type UseSettingsDataResult = {
  runtimeSummary: RuntimeSettingsSummary | null;
  runtimeLoading: boolean;
  runtimeError: string | null;
  config: IntegrationConfig | null;
  roots: RootsConfig | null;
  configLoading: boolean;
  rootsLoading: boolean;
  launchersJson: string;
  availableLaunchers: LauncherCatalogEntry[];
  launcherOverlayIssues: LauncherOverlayIssue[];
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
  keybindingsConfig: KeybindingsConfigResponse | null;
  keybindingsLoading: boolean;
  keybindingsError: string | null;
  keybindingValidationIssues: KeybindingValidationIssue[];
  themesConfig: ThemesConfigResponse | null;
  themesLoading: boolean;
  themesError: string | null;
  themeValidationIssues: ThemeValidationIssue[];
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
  setKeybindingsDraft: Dispatch<SetStateAction<KeybindingsConfigResponse | null>>;
  setThemesConfig: Dispatch<SetStateAction<ThemesConfigResponse | null>>;
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
  const [availableLaunchers, setAvailableLaunchers] = useState<LauncherCatalogEntry[]>([]);
  const [launcherOverlayIssues, setLauncherOverlayIssues] = useState<LauncherOverlayIssue[]>([]);
  const [launchersLoading, setLaunchersLoading] = useState(false);
  const [keybindingsConfig, setKeybindingsConfig] = useState<KeybindingsConfigResponse | null>(null);
  const [keybindingsLoading, setKeybindingsLoading] = useState(false);
  const [keybindingsError, setKeybindingsError] = useState<string | null>(null);
  const [themesConfig, setThemesConfig] = useState<ThemesConfigResponse | null>(null);
  const [themesLoading, setThemesLoading] = useState(false);
  const [themesError, setThemesError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [desktopDaemonInfo, setDesktopDaemonInfo] = useState<DesktopDaemonInfo | null>(null);
  const [browserDaemonStatus, setBrowserDaemonStatus] = useState<BrowserDaemonStatus | null>(null);
  const [restartingDaemon, setRestartingDaemon] = useState(false);
  const [restartingDaemonMode, setRestartingDaemonMode] = useState<"soft" | "force" | null>(null);
  const [daemonActionError, setDaemonActionError] = useState<string | null>(null);
  const [launcherValidationIssues, setLauncherValidationIssues] = useState<LauncherValidationIssue[]>([]);
  const [keybindingValidationIssues, setKeybindingValidationIssues] = useState<KeybindingValidationIssue[]>([]);
  const [themeValidationIssues, setThemeValidationIssues] = useState<ThemeValidationIssue[]>([]);
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());

  const { replaceCustomThemes } = useThemeCatalog();

  const runtimeRequestRef = useRef(0);
  const configRequestRef = useRef(0);
  const rootsRequestRef = useRef(0);
  const launchersRequestRef = useRef(0);
  const keybindingsRequestRef = useRef(0);
  const themesRequestRef = useRef(0);
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
    setKeybindingValidationIssues([]);
    setThemeValidationIssues([]);
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
      const response = await getLauncherRegistry();
      if (launchersRequestRef.current !== requestId) return;
      setLaunchersJson(JSON.stringify(response.registry, null, 2));
      setAvailableLaunchers(response.availableLaunchers);
      setLauncherOverlayIssues(response.overlayIssues);
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

  const loadKeybindings = useCallback(async () => {
    const requestId = ++keybindingsRequestRef.current;
    setKeybindingsLoading(true);
    setKeybindingsError(null);
    try {
      const nextKeybindings = await getKeybindingsConfig();
      if (keybindingsRequestRef.current !== requestId) return;
      setKeybindingsConfig(nextKeybindings);
    } catch (error) {
      if (keybindingsRequestRef.current !== requestId) return;
      setKeybindingsError(error instanceof Error ? error.message : "Failed to load keybindings");
    } finally {
      if (keybindingsRequestRef.current === requestId) {
        setKeybindingsLoading(false);
      }
    }
  }, []);

  const loadThemes = useCallback(async () => {
    const requestId = ++themesRequestRef.current;
    setThemesLoading(true);
    setThemesError(null);
    try {
      const nextThemes = await getThemesConfig();
      if (themesRequestRef.current !== requestId) return;
      setThemesConfig(nextThemes);
      replaceCustomThemes(nextThemes.themes, nextThemes.configPath);
    } catch (error) {
      if (themesRequestRef.current !== requestId) return;
      setThemesError(error instanceof Error ? error.message : "Failed to load themes config");
    } finally {
      if (themesRequestRef.current === requestId) {
        setThemesLoading(false);
      }
    }
  }, [replaceCustomThemes]);

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
      loadKeybindings(),
      loadThemes(),
      loadDesktopDaemonInfo(),
    ]);
  }, [
    loadConfig,
    loadDesktopDaemonInfo,
    loadKeybindings,
    loadLaunchers,
    loadRoots,
    loadRuntime,
    loadThemes,
    resetFeedback,
  ]);

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
            await saveLauncherRegistry(
              parsed as LauncherRegistryConfig | { registry: LauncherRegistryConfig }
            );
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

        if (tab === "keybindings") {
          if (!keybindingsConfig) {
            setSaveError("Keybindings have not loaded yet.");
            return;
          }

          try {
            const savedKeybindings = await saveKeybindingsConfig({
              version: keybindingsConfig.version,
              bindings: keybindingsConfig.bindings,
            });
            setKeybindingsConfig(savedKeybindings);

            if (window.yantraDesktop?.reloadKeybindings) {
              try {
                await window.yantraDesktop.reloadKeybindings();
              } catch (error) {
                setSaveError(
                  error instanceof Error
                    ? `Saved keybindings, but menus could not be reloaded: ${error.message}`
                    : "Saved keybindings, but menus could not be reloaded. Restart Yantra."
                );
              }
            }
          } catch (error) {
            const issues = getKeybindingValidationIssues(error);
            setSaveError(
              error instanceof Error ? error.message : "Failed to save keybindings."
            );
            setKeybindingValidationIssues(issues);
            return;
          }
        }

        if (tab === "themes") {
          if (!themesConfig) {
            setSaveError("Theme settings have not loaded yet.");
            return;
          }

          try {
            const savedThemes = await saveThemesConfig(themesConfig);
            setThemesConfig(savedThemes);
            replaceCustomThemes(savedThemes.themes, savedThemes.configPath);
          } catch (error) {
            const issues = getThemeValidationIssues(error);
            setSaveError(
              error instanceof Error ? error.message : "Failed to save themes config."
            );
            setThemeValidationIssues(issues);
            return;
          }
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
    [
      clearSavedTimeout,
      config,
      keybindingsConfig,
      launchersJson,
      loadLaunchers,
      loadRuntime,
      replaceCustomThemes,
      resetFeedback,
      roots,
      themesConfig,
    ]
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

  const setKeybindingsDraft = useCallback(
    (value: SetStateAction<KeybindingsConfigResponse | null>) => {
      setKeybindingsConfig(value);
      setSaveError(null);
      setKeybindingValidationIssues([]);
    },
    []
  );

  useEffect(() => {
    void Promise.allSettled([
      loadRuntime(),
      loadConfig(),
      loadLaunchers(),
      loadRoots(),
      loadKeybindings(),
      loadThemes(),
      loadDesktopDaemonInfo(),
    ]);
  }, [loadConfig, loadDesktopDaemonInfo, loadKeybindings, loadLaunchers, loadRoots, loadRuntime, loadThemes]);

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
    availableLaunchers,
    launcherOverlayIssues,
    launchersLoading,
    keybindingsConfig,
    keybindingsLoading,
    saving,
    saved,
    saveError,
    desktopDaemonInfo,
    browserDaemonStatus,
    restartingDaemon,
    restartingDaemonMode,
    daemonActionError,
    launcherValidationIssues,
    keybindingsError,
    keybindingValidationIssues,
    themesConfig,
    themesLoading,
    themesError,
    themeValidationIssues,
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
    setKeybindingsDraft,
    setThemesConfig,
    setLaunchersJsonDraft,
  };
}
