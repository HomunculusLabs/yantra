"use client";

import { useState } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const CRON_PRESETS = [
  { label: "Every hour", cron: "0 * * * *" },
  { label: "Every 2 hours", cron: "0 */2 * * *" },
  { label: "Every 4 hours", cron: "0 */4 * * *" },
  { label: "Every 6 hours", cron: "0 */6 * * *" },
  { label: "Every day at 9am", cron: "0 9 * * *" },
  { label: "Every day at noon", cron: "0 12 * * *" },
  { label: "Every day at 6pm", cron: "0 18 * * *" },
  { label: "Weekdays at 9am", cron: "0 9 * * 1-5" },
  { label: "Weekdays at 8am & 2pm", cron: "0 8,14 * * 1-5" },
  { label: "Monday at 9am", cron: "0 9 * * 1" },
  { label: "Mon, Wed, Fri at 9am", cron: "0 9 * * 1,3,5" },
  { label: "Every 15 minutes", cron: "*/15 * * * *" },
  { label: "Every 30 minutes", cron: "*/30 * * * *" },
  { label: "Twice daily (9am & 5pm)", cron: "0 9,17 * * *" },
  { label: "Weekly on Sunday", cron: "0 9 * * 0" },
] as const;

export function cronToHuman(cron: string): string {
  const preset = CRON_PRESETS.find((entry) => entry.cron === cron);
  if (preset) return preset.label;
  return cron;
}

type CronPickerProps = {
  value: string;
  onChange: (cron: string) => void;
  onDone?: () => void;
  compact?: boolean;
};

export function CronPicker({
  value,
  onChange,
  onDone,
  compact,
}: CronPickerProps) {
  const [showCustom, setShowCustom] = useState(false);
  const [custom, setCustom] = useState(value);
  const isPreset = CRON_PRESETS.some((entry) => entry.cron === value);

  return (
    <div className={cn("space-y-1", compact ? "" : "space-y-1.5")}>
      <div className="flex flex-wrap gap-1">
        {CRON_PRESETS.map((preset) => (
          <button
            key={preset.cron}
            onClick={() => {
              onChange(preset.cron);
              setShowCustom(false);
              onDone?.();
            }}
            className={cn(
              "rounded border px-2 py-0.5 text-[10px] transition-colors",
              value === preset.cron
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            )}
          >
            {preset.label}
          </button>
        ))}
        <button
          onClick={() => {
            setShowCustom(!showCustom);
            setCustom(value);
          }}
          className={cn(
            "rounded border px-2 py-0.5 text-[10px] transition-colors",
            showCustom || (!isPreset && value)
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          )}
        >
          Custom
        </button>
      </div>
      {(showCustom || (!isPreset && value)) && (
        <div className="flex items-center gap-1">
          <input
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                onChange(custom);
                onDone?.();
              }
              if (event.key === "Escape") {
                setShowCustom(false);
                onDone?.();
              }
            }}
            className="flex-1 rounded border border-border bg-background px-2 py-0.5 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
            placeholder="e.g. 0 9 * * 1-5"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={() => {
              onChange(custom);
              onDone?.();
            }}
          >
            <Save className="h-3 w-3" />
          </Button>
        </div>
      )}
      {value && (
        <p className="font-mono text-[10px] text-muted-foreground/60">
          {value} {isPreset ? "" : `— ${value}`}
        </p>
      )}
    </div>
  );
}
