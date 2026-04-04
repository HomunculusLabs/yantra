"use client";

import { useState } from "react";
import {
  ArrowLeft,
  Bell,
  CheckCircle,
  Cpu,
  Eye,
  EyeOff,
  FolderOpen,
  Loader2,
  MessageSquare,
  Cloud,
  Mail,
  Plug,
  RefreshCw,
  Save,
  Send,
  Settings,
  Sparkles,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LauncherRegistryTab } from "@/components/settings/launcher-registry-tab";
import { RuntimeSettingsTab } from "@/components/settings/runtime-settings-tab";
import { StorageSettingsTab } from "@/components/settings/storage-settings-tab";
import { useSettingsData } from "@/components/settings/use-settings-data";
import { cn } from "@/lib/utils";
import type { SettingsTab } from "@/types/settings";

export function SettingsPage({ onExit }: { onExit?: () => void } = {}) {
  const [tab, setTab] = useState<SettingsTab>("runtime");
  const {
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
    requestNotificationTest,
    toggleReveal,
    updateMcp,
    updateMcpEnv,
    updateNotif,
    updateScheduling,
    setRoots,
    setLaunchersJsonDraft,
  } = useSettingsData();

  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: "runtime", label: "Runtime", icon: <Cpu className="h-3.5 w-3.5" /> },
    {
      id: "launchers",
      label: "Launcher Registry",
      icon: <Sparkles className="h-3.5 w-3.5" />,
    },
    { id: "storage", label: "Storage", icon: <FolderOpen className="h-3.5 w-3.5" /> },
    { id: "integrations", label: "Integrations", icon: <Plug className="h-3.5 w-3.5" /> },
    { id: "notifications", label: "Notifications", icon: <Bell className="h-3.5 w-3.5" /> },
  ];

  const showSaveButton =
    tab === "storage" ||
    tab === "integrations" ||
    tab === "notifications" ||
    tab === "launchers";

  return (
    <div className="h-full min-h-0 flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          {onExit ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-[12px]"
              onClick={onExit}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Exit
            </Button>
          ) : null}
          <Settings className="h-4 w-4" />
          <h2 className="text-[15px] font-semibold tracking-[-0.02em]">Settings</h2>
        </div>
        <div className="flex items-center gap-1.5">
          {showSaveButton ? (
            <Button
              variant={saved ? "default" : "outline"}
              size="sm"
              className={cn(
                "h-7 gap-1.5 text-[12px]",
                saved && "bg-emerald-600 text-white hover:bg-emerald-700"
              )}
              onClick={() => void saveCurrentTab(tab)}
              disabled={saving}
            >
              {saving ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : saved ? (
                <CheckCircle className="h-3 w-3" />
              ) : (
                <Save className="h-3 w-3" />
              )}
              {saving ? "Saving..." : saved ? "Saved" : "Save"}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-[12px]"
            onClick={() => void refreshAll()}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-border px-4 py-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              resetFeedback();
              setTab(t.id);
            }}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors",
              tab === t.id
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="max-w-5xl space-y-6 p-4">
          {saveError ? (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-[12px] text-red-200">
              {saveError}
            </div>
          ) : null}

          {tab === "runtime" ? (
            <RuntimeSettingsTab
              summary={runtimeSummary}
              loading={runtimeLoading}
              error={runtimeError}
              rootsRestartRequired={roots?.restartRequired}
              daemonStatus={browserDaemonStatus}
              canRestartDaemon={Boolean(desktopDaemonInfo?.managed)}
              restartingDaemon={restartingDaemon}
              restartingDaemonMode={restartingDaemonMode}
              onRestartDaemon={restartDaemon}
              daemonActionError={daemonActionError}
            />
          ) : null}

          {tab === "launchers" ? (
            <LauncherRegistryTab
              loading={launchersLoading}
              runtimeSummary={runtimeSummary}
              value={launchersJson}
              onChange={(value) => {
                setLaunchersJsonDraft(value);
              }}
              error={saveError}
              validationIssues={launcherValidationIssues}
            />
          ) : null}

          {tab === "storage" && (
            <StorageSettingsTab
              roots={roots}
              loading={rootsLoading}
              onChange={(nextRoots) => setRoots(nextRoots)}
            />
          )}

          {tab === "integrations" && config && (
            <>
              <div>
                <h3 className="mb-1 text-[14px] font-semibold">MCP Servers</h3>
                <p className="mb-4 text-xs text-muted-foreground">
                  Configure tool servers that agents can use. Enable a server and provide API credentials for agents to access external services.
                </p>

                <div className="space-y-3">
                  {Object.entries(config.mcp_servers).map(([id, server]) => (
                    <div
                      key={id}
                      className={cn(
                        "rounded-lg border bg-card p-3 transition-colors",
                        server.enabled ? "border-primary/30" : "border-border"
                      )}
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => updateMcp(id, "enabled", !server.enabled)}
                            className={cn(
                              "relative h-4 w-8 rounded-full transition-colors",
                              server.enabled ? "bg-emerald-500" : "bg-muted-foreground/30"
                            )}
                          >
                            <span
                              className={cn(
                                "absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all",
                                server.enabled ? "left-4" : "left-0.5"
                              )}
                            />
                          </button>
                          <span className="text-[13px] font-medium">{server.name}</span>
                        </div>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px]",
                            server.enabled
                              ? "bg-emerald-500/10 text-emerald-500"
                              : "bg-muted text-muted-foreground"
                          )}
                        >
                          {server.enabled ? "Active" : "Disabled"}
                        </span>
                      </div>

                      {server.description ? (
                        <p className="mb-2 text-[11px] text-muted-foreground">{server.description}</p>
                      ) : null}

                      <div className="space-y-1.5">
                        <div>
                          <label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                            Command
                          </label>
                          <input
                            type="text"
                            value={server.command}
                            onChange={(e) => updateMcp(id, "command", e.target.value)}
                            className="mt-0.5 w-full rounded border border-border/50 bg-muted/30 px-2 py-1 font-mono text-[12px] focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        </div>

                        {Object.entries(server.env).map(([envKey, envVal]) => {
                          const revealKey = `${id}.${envKey}`;
                          const isRevealed = revealedKeys.has(revealKey);
                          return (
                            <div key={envKey}>
                              <label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                                {envKey}
                              </label>
                              <div className="mt-0.5 flex gap-1">
                                <input
                                  type={isRevealed ? "text" : "password"}
                                  value={envVal}
                                  onChange={(e) => updateMcpEnv(id, envKey, e.target.value)}
                                  placeholder={`Enter ${envKey}...`}
                                  className="flex-1 rounded border border-border/50 bg-muted/30 px-2 py-1 font-mono text-[12px] placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-ring"
                                />
                                <button
                                  onClick={() => toggleReveal(revealKey)}
                                  className="px-1.5 text-muted-foreground/50 transition-colors hover:text-foreground"
                                  title={isRevealed ? "Hide" : "Reveal"}
                                >
                                  {isRevealed ? (
                                    <EyeOff className="h-3.5 w-3.5" />
                                  ) : (
                                    <Eye className="h-3.5 w-3.5" />
                                  )}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-border pt-6">
                <h3 className="mb-1 text-[14px] font-semibold">Scheduling Defaults</h3>
                <p className="mb-4 text-xs text-muted-foreground">
                  Configure default scheduling behavior for agents and jobs.
                </p>

                <div className="space-y-3 rounded-lg border border-border bg-card p-3">
                  <div>
                    <label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                      Max Concurrent Agents
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={config.scheduling.max_concurrent_agents}
                      onChange={(e) =>
                        updateScheduling(
                          "max_concurrent_agents",
                          parseInt(e.target.value, 10) || 10
                        )
                      }
                      className="mt-0.5 w-full rounded border border-border/50 bg-muted/30 px-2 py-1 text-[12px] focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>

                  <div>
                    <label className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                      <Clock className="h-3 w-3" />
                      Active Hours
                    </label>
                    <input
                      type="text"
                      value={config.scheduling.active_hours}
                      onChange={(e) => updateScheduling("active_hours", e.target.value)}
                      placeholder="8-22"
                      className="mt-0.5 w-full rounded border border-border/50 bg-muted/30 px-2 py-1 text-[12px] focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <p className="mt-0.5 text-[10px] text-muted-foreground/50">
                      Agents only run heartbeats during these hours (for example, 8-22).
                    </p>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[12px] font-medium">Pause on Error</p>
                      <p className="text-[10px] text-muted-foreground/60">
                        Auto-pause agents after 3 consecutive failures
                      </p>
                    </div>
                    <button
                      onClick={() =>
                        updateScheduling(
                          "pause_on_error",
                          !config.scheduling.pause_on_error
                        )
                      }
                      className={cn(
                        "relative h-4 w-8 rounded-full transition-colors",
                        config.scheduling.pause_on_error
                          ? "bg-emerald-500"
                          : "bg-muted-foreground/30"
                      )}
                    >
                      <span
                        className={cn(
                          "absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all",
                          config.scheduling.pause_on_error ? "left-4" : "left-0.5"
                        )}
                      />
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}

          {tab === "notifications" && config && (
            <>
              <div>
                <h3 className="mb-1 text-[14px] font-semibold">Notification Channels</h3>
                <p className="mb-4 text-xs text-muted-foreground">
                  Configure how you receive alerts when agents need your attention. Notifications fire for #alerts messages and @human mentions.
                </p>

                <div className="space-y-3">
                  <div
                    className={cn(
                      "rounded-lg border bg-card p-3 transition-colors",
                      config.notifications.browser_push
                        ? "border-primary/30"
                        : "border-border"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Bell className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-[13px] font-medium">Browser Push</p>
                          <p className="text-[11px] text-muted-foreground">
                            Instant alerts when Yantra tab is open or PWA installed
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() =>
                          updateNotif(
                            "browser_push",
                            !config.notifications.browser_push
                          )
                        }
                        className={cn(
                          "relative h-4 w-8 rounded-full transition-colors",
                          config.notifications.browser_push
                            ? "bg-emerald-500"
                            : "bg-muted-foreground/30"
                        )}
                      >
                        <span
                          className={cn(
                            "absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all",
                            config.notifications.browser_push ? "left-4" : "left-0.5"
                          )}
                        />
                      </button>
                    </div>
                  </div>

                  <div
                    className={cn(
                      "rounded-lg border bg-card p-3 transition-colors",
                      config.notifications.telegram.enabled
                        ? "border-primary/30"
                        : "border-border"
                    )}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Send className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-[13px] font-medium">Telegram</p>
                          <p className="text-[11px] text-muted-foreground">
                            Instant mobile notifications via Telegram bot
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() =>
                          updateNotif(
                            "telegram.enabled",
                            !config.notifications.telegram.enabled
                          )
                        }
                        className={cn(
                          "relative h-4 w-8 rounded-full transition-colors",
                          config.notifications.telegram.enabled
                            ? "bg-emerald-500"
                            : "bg-muted-foreground/30"
                        )}
                      >
                        <span
                          className={cn(
                            "absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all",
                            config.notifications.telegram.enabled ? "left-4" : "left-0.5"
                          )}
                        />
                      </button>
                    </div>

                    {config.notifications.telegram.enabled ? (
                      <div className="mt-2 space-y-1.5">
                        <div>
                          <label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                            Bot Token
                          </label>
                          <div className="mt-0.5 flex gap-1">
                            <input
                              type={revealedKeys.has("tg.token") ? "text" : "password"}
                              value={config.notifications.telegram.bot_token}
                              onChange={(e) => updateNotif("telegram.bot_token", e.target.value)}
                              placeholder="123456:ABC-DEF..."
                              className="flex-1 rounded border border-border/50 bg-muted/30 px-2 py-1 font-mono text-[12px] placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                            <button
                              onClick={() => toggleReveal("tg.token")}
                              className="px-1.5 text-muted-foreground/50 transition-colors hover:text-foreground"
                            >
                              {revealedKeys.has("tg.token") ? (
                                <EyeOff className="h-3.5 w-3.5" />
                              ) : (
                                <Eye className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                            Chat ID
                          </label>
                          <input
                            type="text"
                            value={config.notifications.telegram.chat_id}
                            onChange={(e) => updateNotif("telegram.chat_id", e.target.value)}
                            placeholder="Your Telegram chat ID"
                            className="mt-0.5 w-full rounded border border-border/50 bg-muted/30 px-2 py-1 font-mono text-[12px] placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div
                    className={cn(
                      "rounded-lg border bg-card p-3 transition-colors",
                      config.notifications.slack_webhook.enabled
                        ? "border-primary/30"
                        : "border-border"
                    )}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <MessageSquare className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-[13px] font-medium">Slack Webhook</p>
                          <p className="text-[11px] text-muted-foreground">
                            Forward alerts to your team&apos;s Slack channel
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() =>
                          updateNotif(
                            "slack_webhook.enabled",
                            !config.notifications.slack_webhook.enabled
                          )
                        }
                        className={cn(
                          "relative h-4 w-8 rounded-full transition-colors",
                          config.notifications.slack_webhook.enabled
                            ? "bg-emerald-500"
                            : "bg-muted-foreground/30"
                        )}
                      >
                        <span
                          className={cn(
                            "absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all",
                            config.notifications.slack_webhook.enabled
                              ? "left-4"
                              : "left-0.5"
                          )}
                        />
                      </button>
                    </div>

                    {config.notifications.slack_webhook.enabled ? (
                      <div className="mt-2">
                        <label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                          Webhook URL
                        </label>
                        <div className="mt-0.5 flex gap-1">
                          <input
                            type={revealedKeys.has("slack.url") ? "text" : "password"}
                            value={config.notifications.slack_webhook.url}
                            onChange={(e) => updateNotif("slack_webhook.url", e.target.value)}
                            placeholder="https://hooks.slack.com/services/..."
                            className="flex-1 rounded border border-border/50 bg-muted/30 px-2 py-1 font-mono text-[12px] placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                          <button
                            onClick={() => toggleReveal("slack.url")}
                            className="px-1.5 text-muted-foreground/50 transition-colors hover:text-foreground"
                          >
                            {revealedKeys.has("slack.url") ? (
                              <EyeOff className="h-3.5 w-3.5" />
                            ) : (
                              <Eye className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div
                    className={cn(
                      "rounded-lg border bg-card p-3 transition-colors",
                      config.notifications.email.enabled
                        ? "border-primary/30"
                        : "border-border"
                    )}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Mail className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-[13px] font-medium">Email Digest</p>
                          <p className="text-[11px] text-muted-foreground">
                            Batched summary of alerts and agent activity
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() =>
                          updateNotif(
                            "email.enabled",
                            !config.notifications.email.enabled
                          )
                        }
                        className={cn(
                          "relative h-4 w-8 rounded-full transition-colors",
                          config.notifications.email.enabled
                            ? "bg-emerald-500"
                            : "bg-muted-foreground/30"
                        )}
                      >
                        <span
                          className={cn(
                            "absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all",
                            config.notifications.email.enabled ? "left-4" : "left-0.5"
                          )}
                        />
                      </button>
                    </div>

                    {config.notifications.email.enabled ? (
                      <div className="mt-2 space-y-1.5">
                        <div>
                          <label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                            Email Address
                          </label>
                          <input
                            type="email"
                            value={config.notifications.email.to}
                            onChange={(e) => updateNotif("email.to", e.target.value)}
                            placeholder="founder@company.com"
                            className="mt-0.5 w-full rounded border border-border/50 bg-muted/30 px-2 py-1 text-[12px] placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                            Frequency
                          </label>
                          <div className="mt-1 flex gap-2">
                            {(["hourly", "daily"] as const).map((freq) => (
                              <button
                                key={freq}
                                onClick={() => updateNotif("email.frequency", freq)}
                                className={cn(
                                  "rounded-md border px-3 py-1 text-[11px] font-medium transition-colors",
                                  config.notifications.email.frequency === freq
                                    ? "border-primary/30 bg-primary/10 text-primary"
                                    : "border-border/50 bg-muted/30 text-muted-foreground hover:border-border"
                                )}
                              >
                                {freq.charAt(0).toUpperCase() + freq.slice(1)}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div
                    className={cn(
                      "rounded-lg border bg-card p-3 transition-colors",
                      config.notifications.nextcloud_talk.enabled
                        ? "border-primary/30"
                        : "border-border"
                    )}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Cloud className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-[13px] font-medium">Nextcloud Talk</p>
                          <p className="text-[11px] text-muted-foreground">
                            Send alerts and job updates into Nextcloud rooms
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() =>
                          updateNotif(
                            "nextcloud_talk.enabled",
                            !config.notifications.nextcloud_talk.enabled
                          )
                        }
                        className={cn(
                          "relative h-4 w-8 rounded-full transition-colors",
                          config.notifications.nextcloud_talk.enabled
                            ? "bg-emerald-500"
                            : "bg-muted-foreground/30"
                        )}
                      >
                        <span
                          className={cn(
                            "absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all",
                            config.notifications.nextcloud_talk.enabled
                              ? "left-4"
                              : "left-0.5"
                          )}
                        />
                      </button>
                    </div>

                    {config.notifications.nextcloud_talk.enabled ? (
                      <div className="mt-2 space-y-1.5">
                        <div>
                          <label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                            Server URL
                          </label>
                          <input
                            type="text"
                            value={config.notifications.nextcloud_talk.server_url}
                            onChange={(e) =>
                              updateNotif("nextcloud_talk.server_url", e.target.value)
                            }
                            placeholder="https://nextcloud.example.com"
                            className="mt-0.5 w-full rounded border border-border/50 bg-muted/30 px-2 py-1 font-mono text-[12px] placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                            Username
                          </label>
                          <input
                            type="text"
                            value={config.notifications.nextcloud_talk.username}
                            onChange={(e) =>
                              updateNotif("nextcloud_talk.username", e.target.value)
                            }
                            placeholder="nextcloud username"
                            className="mt-0.5 w-full rounded border border-border/50 bg-muted/30 px-2 py-1 font-mono text-[12px] placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                            App Password
                          </label>
                          <div className="mt-0.5 flex gap-1">
                            <input
                              type={revealedKeys.has("nc.password") ? "text" : "password"}
                              value={config.notifications.nextcloud_talk.app_password}
                              onChange={(e) =>
                                updateNotif("nextcloud_talk.app_password", e.target.value)
                              }
                              placeholder="Nextcloud app password"
                              className="flex-1 rounded border border-border/50 bg-muted/30 px-2 py-1 font-mono text-[12px] placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                            <button
                              onClick={() => toggleReveal("nc.password")}
                              className="px-1.5 text-muted-foreground/50 transition-colors hover:text-foreground"
                            >
                              {revealedKeys.has("nc.password") ? (
                                <EyeOff className="h-3.5 w-3.5" />
                              ) : (
                                <Eye className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                            Default Room Token
                          </label>
                          <input
                            type="text"
                            value={config.notifications.nextcloud_talk.default_room_token}
                            onChange={(e) =>
                              updateNotif(
                                "nextcloud_talk.default_room_token",
                                e.target.value
                              )
                            }
                            placeholder="Talk room token"
                            className="mt-0.5 w-full rounded border border-border/50 bg-muted/30 px-2 py-1 font-mono text-[12px] placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="border-t border-border pt-6">
                <h3 className="mb-1 text-[14px] font-semibold">Alert Rules</h3>
                <p className="mb-4 text-xs text-muted-foreground">
                  Notifications are triggered automatically for these events:
                </p>
                <div className="space-y-2">
                  {[
                    {
                      event: "#alerts channel messages",
                      desc: "Any agent posting to the alerts channel",
                    },
                    {
                      event: "@human mentions",
                      desc: "When an agent mentions @human in any channel",
                    },
                    {
                      event: "Goal floor breached",
                      desc: "A goal drops below its minimum threshold",
                    },
                    {
                      event: "Agent health degraded",
                      desc: "3+ consecutive heartbeat failures",
                    },
                  ].map((rule) => (
                    <div
                      key={rule.event}
                      className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2"
                    >
                      <div>
                        <p className="text-[12px] font-medium">{rule.event}</p>
                        <p className="text-[10px] text-muted-foreground/60">{rule.desc}</p>
                      </div>
                      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-500">
                        Always on
                      </span>
                    </div>
                  ))}
                </div>
                <button
                  className="mt-4 rounded-md border border-border px-3 py-1.5 text-[12px] transition-colors hover:bg-muted/40"
                  onClick={async () => {
                    try {
                      const data = await requestNotificationTest();
                      alert(data.message);
                    } catch {
                      alert("Failed to send test notification.");
                    }
                  }}
                >
                  <Bell className="mr-1.5 inline h-3 w-3" />
                  Send Test Notification
                </button>
              </div>
            </>
          )}

          {tab === "integrations" && !config && configLoading ? (
            <p className="text-[13px] text-muted-foreground">Loading configuration...</p>
          ) : null}
          {tab === "notifications" && !config && configLoading ? (
            <p className="text-[13px] text-muted-foreground">Loading configuration...</p>
          ) : null}
          {tab === "launchers" && launchersLoading && !launchersJson ? (
            <p className="text-[13px] text-muted-foreground">
              Loading launcher configuration...
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
