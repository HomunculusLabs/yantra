"use client";

import { useEffect, useMemo, useState } from "react";
import { getLauncherRegistry } from "@/lib/api/agents-client";
import { BASIC_LAUNCHER_OPTIONS } from "@/lib/agents/basic-launcher-options";
import type { LauncherCatalogEntry } from "@/types/launchers";

function getFallbackLauncherOptions(): LauncherCatalogEntry[] {
  return BASIC_LAUNCHER_OPTIONS.map((option) => ({
    id: option.value,
    label: option.label,
    description: option.description,
    readOnly: false,
    source: { kind: "owned" as const },
  }));
}

export function LauncherIdSelect({
  value,
  onChange,
  includeEmpty = false,
  emptyLabel = "Use registry default",
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  includeEmpty?: boolean;
  emptyLabel?: string;
  className?: string;
}) {
  const [availableLaunchers, setAvailableLaunchers] = useState<LauncherCatalogEntry[]>(() =>
    getFallbackLauncherOptions()
  );

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

  const options = useMemo(() => {
    const trimmedValue = value.trim();
    if (!trimmedValue || availableLaunchers.some((launcher) => launcher.id === trimmedValue)) {
      return availableLaunchers;
    }
    return [
      ...availableLaunchers,
      {
        id: trimmedValue,
        label: trimmedValue,
        description: "Currently selected launcher is unavailable.",
        readOnly: true,
        source: { kind: "owned" as const },
      },
    ];
  }, [availableLaunchers, value]);

  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={className}
    >
      {includeEmpty ? <option value="">{emptyLabel}</option> : null}
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.source.kind === "plugin"
            ? `${option.label} — plugin`
            : option.readOnly && option.description === "Currently selected launcher is unavailable."
              ? `${option.label} — unavailable`
              : option.label}
        </option>
      ))}
    </select>
  );
}
