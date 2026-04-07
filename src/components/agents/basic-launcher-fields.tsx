"use client";

import { useEffect, useMemo, useState } from "react";
import type { AgentLaunchConfig, LauncherCatalogEntry } from "@/types/launchers";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getLauncherRegistry } from "@/lib/api/agents-client";
import {
  BASIC_LAUNCHER_OPTIONS,
  getLauncherModelOptions,
  isBasicLauncherId,
  isPresetModelForLauncher,
} from "@/lib/agents/basic-launcher-options";

const DEFAULT_CUSTOM_MODEL_OPTIONS = [
  { value: "", label: "Default" },
  { value: "__custom__", label: "Custom…" },
];

function getFallbackLauncherOptions(): LauncherCatalogEntry[] {
  return BASIC_LAUNCHER_OPTIONS.map((option) => ({
    id: option.value,
    label: option.label,
    description: option.description,
    readOnly: false,
    source: { kind: "owned" as const },
  }));
}

function getLauncherDescription(option: LauncherCatalogEntry | undefined): string {
  if (!option) {
    return "Launcher selection controls how this agent starts.";
  }
  if (option.source.kind === "plugin") {
    return option.description || `Plugin launcher from ${option.source.pluginName}.`;
  }
  return option.description || "Launcher selection controls how this agent starts.";
}

export function BasicLauncherFields({
  value,
  onChange,
  className,
}: {
  value?: AgentLaunchConfig | null;
  onChange: (value: AgentLaunchConfig | null) => void;
  className?: string;
}) {
  const [availableLaunchers, setAvailableLaunchers] = useState<LauncherCatalogEntry[]>(() =>
    getFallbackLauncherOptions()
  );
  const currentLauncherId = value?.launcherId?.trim() || "claude-code";
  const currentModel = value?.model?.trim() || "";
  const isBuiltInLauncher = isBasicLauncherId(currentLauncherId);
  const modelOptions = isBuiltInLauncher
    ? getLauncherModelOptions(currentLauncherId)
    : DEFAULT_CUSTOM_MODEL_OPTIONS;
  const [customModelOpen, setCustomModelOpen] = useState(false);
  const usesCustomModel =
    currentModel.length > 0 &&
    (!isBuiltInLauncher || !isPresetModelForLauncher(currentLauncherId, currentModel));
  const showCustomModelInput = customModelOpen || usesCustomModel;
  const selectedModel = showCustomModelInput ? "__custom__" : currentModel;

  useEffect(() => {
    let cancelled = false;
    void getLauncherRegistry()
      .then((response) => {
        if (cancelled) return;
        if (response.availableLaunchers.length > 0) {
          setAvailableLaunchers(response.availableLaunchers);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAvailableLaunchers(getFallbackLauncherOptions());
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedLauncher = useMemo(
    () => availableLaunchers.find((launcher) => launcher.id === currentLauncherId),
    [availableLaunchers, currentLauncherId]
  );
  const launcherOptions = useMemo(() => {
    if (selectedLauncher) return availableLaunchers;
    return [
      ...availableLaunchers,
      {
        id: currentLauncherId,
        label: currentLauncherId,
        description: "Currently selected launcher is unavailable.",
        readOnly: true,
        source: { kind: "owned" as const },
      },
    ];
  }, [availableLaunchers, currentLauncherId, selectedLauncher]);

  const updateLauncher = (
    nextLauncherId: string,
    patch?: Partial<AgentLaunchConfig | null>
  ) => {
    const hasExplicitModelPatch = Boolean(
      patch && Object.prototype.hasOwnProperty.call(patch, "model")
    );
    const next: AgentLaunchConfig = {
      ...(value || {}),
      launcherId: nextLauncherId,
      ...(patch || {}),
    };

    if (!hasExplicitModelPatch && next.model) {
      const currentUsesPresetModel =
        isBuiltInLauncher && isPresetModelForLauncher(currentLauncherId, next.model);
      const nextUsesPresetModel =
        isBasicLauncherId(nextLauncherId) && isPresetModelForLauncher(nextLauncherId, next.model);
      if (currentUsesPresetModel && !nextUsesPresetModel) {
        next.model = undefined;
      }
    }

    onChange(next);
  };

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-[11px] text-muted-foreground">
          <span>Launcher</span>
          <select
            value={currentLauncherId}
            onChange={(event) => updateLauncher(event.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground"
          >
            {launcherOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.source.kind === "plugin"
                  ? `${option.label} — plugin`
                  : option.label}
              </option>
            ))}
          </select>
          <span className="block text-[10px] text-muted-foreground/70">
            {getLauncherDescription(selectedLauncher || launcherOptions.find((option) => option.id === currentLauncherId))}
          </span>
        </label>

        <label className="flex flex-col gap-1.5 text-[11px] text-muted-foreground">
          <span>Model</span>
          <select
            value={selectedModel}
            onChange={(event) => {
              const nextValue = event.target.value;
              if (nextValue === "__custom__") {
                setCustomModelOpen(true);
                updateLauncher(currentLauncherId, {
                  model: currentModel || "",
                });
                return;
              }

              setCustomModelOpen(false);
              updateLauncher(currentLauncherId, {
                model: nextValue,
              });
            }}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground"
          >
            {modelOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <span className="block text-[10px] text-muted-foreground/70">
            {isBuiltInLauncher
              ? "Saved with the launcher and reflected in the resolved launch command."
              : "Plugin and custom launchers only support default or custom model values here."}
          </span>
        </label>
      </div>

      {showCustomModelInput ? (
        <label className="flex flex-col gap-1.5 text-[11px] text-muted-foreground">
          <span>Custom model</span>
          <Input
            value={currentModel}
            onChange={(event) =>
              updateLauncher(currentLauncherId, {
                model: event.target.value || undefined,
              })
            }
            placeholder="Enter an exact model id"
            className="font-mono text-[13px]"
            spellCheck={false}
          />
        </label>
      ) : null}
    </div>
  );
}
