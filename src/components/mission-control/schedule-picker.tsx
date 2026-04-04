"use client";

import { useMemo, useState } from "react";
import { Check, Clock, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { cronToHuman } from "@/lib/agents/cron-utils";

interface SchedulePickerProps {
  value: string;
  onChange: (cron: string) => void;
  label?: string;
}

type ScheduleKind =
  | "minutes"
  | "hours"
  | "daily"
  | "weekdays"
  | "weekly"
  | "monthly"
  | "custom";

interface ScheduleConfig {
  kind: ScheduleKind;
  minuteInterval: number;
  hourInterval: number;
  time: string;
  dayOfWeek: string;
  dayOfMonth: number;
}

const DAY_OPTIONS = [
  { value: "0", label: "Sunday" },
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
];

const SCHEDULE_KIND_OPTIONS = [
  { value: "minutes", label: "Every few minutes" },
  { value: "hours", label: "Every few hours" },
  { value: "daily", label: "Daily" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "custom", label: "Advanced cron" },
] as const;

const DEFAULT_CONFIG: ScheduleConfig = {
  kind: "daily",
  minuteInterval: 15,
  hourInterval: 4,
  time: "09:00",
  dayOfWeek: "1",
  dayOfMonth: 1,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isIntegerFieldWithin(value: string, min: number, max: number): boolean {
  if (!/^\d+$/.test(value)) return false;
  const parsed = Number.parseInt(value, 10);
  return parsed >= min && parsed <= max;
}

function toTime(hour: string, minute: string): string {
  const parsedHour = clamp(Number.parseInt(hour, 10) || 0, 0, 23);
  const parsedMinute = clamp(Number.parseInt(minute, 10) || 0, 0, 59);
  return `${String(parsedHour).padStart(2, "0")}:${String(parsedMinute).padStart(2, "0")}`;
}

function parseTime(time: string): { hour: number; minute: number } {
  const [hour, minute] = time.split(":").map((part) => Number.parseInt(part, 10) || 0);
  return {
    hour: clamp(hour, 0, 23),
    minute: clamp(minute, 0, 59),
  };
}

function parseCron(cron: string): ScheduleConfig {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    return { ...DEFAULT_CONFIG, kind: "custom" };
  }

  const [minute, hour, dayOfMonth, month, rawDayOfWeek] = parts;
  const dayOfWeek = rawDayOfWeek === "7" ? "0" : rawDayOfWeek;

  if (minute.startsWith("*/") && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    const interval = Number.parseInt(minute.slice(2), 10);
    if (!Number.isFinite(interval) || interval < 1 || interval > 59) {
      return { ...DEFAULT_CONFIG, kind: "custom" };
    }

    return {
      ...DEFAULT_CONFIG,
      kind: "minutes",
      minuteInterval: interval,
    };
  }

  if (minute === "0" && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return {
      ...DEFAULT_CONFIG,
      kind: "hours",
      hourInterval: 1,
      time: "00:00",
    };
  }

  if (minute === "0" && hour.startsWith("*/") && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    const interval = Number.parseInt(hour.slice(2), 10);
    if (!Number.isFinite(interval) || interval < 1 || interval > 23) {
      return { ...DEFAULT_CONFIG, kind: "custom" };
    }

    return {
      ...DEFAULT_CONFIG,
      kind: "hours",
      hourInterval: interval,
      time: "00:00",
    };
  }

  const hasSpecificTime = isIntegerFieldWithin(minute, 0, 59) && isIntegerFieldWithin(hour, 0, 23);
  if (hasSpecificTime && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return {
      ...DEFAULT_CONFIG,
      kind: "daily",
      time: toTime(hour, minute),
    };
  }

  if (hasSpecificTime && dayOfMonth === "*" && month === "*" && dayOfWeek === "1-5") {
    return {
      ...DEFAULT_CONFIG,
      kind: "weekdays",
      time: toTime(hour, minute),
    };
  }

  if (hasSpecificTime && dayOfMonth === "*" && month === "*" && isIntegerFieldWithin(dayOfWeek, 0, 6)) {
    return {
      ...DEFAULT_CONFIG,
      kind: "weekly",
      time: toTime(hour, minute),
      dayOfWeek,
    };
  }

  if (hasSpecificTime && isIntegerFieldWithin(dayOfMonth, 1, 31) && month === "*" && dayOfWeek === "*") {
    return {
      ...DEFAULT_CONFIG,
      kind: "monthly",
      time: toTime(hour, minute),
      dayOfMonth: Number.parseInt(dayOfMonth, 10),
    };
  }

  return { ...DEFAULT_CONFIG, kind: "custom" };
}

function buildCron(config: ScheduleConfig): string {
  const { hour, minute } = parseTime(config.time);

  switch (config.kind) {
    case "minutes":
      return `*/${clamp(config.minuteInterval, 1, 59)} * * * *`;
    case "hours":
      if (config.hourInterval <= 1) return "0 * * * *";
      return `0 */${clamp(config.hourInterval, 1, 23)} * * *`;
    case "daily":
      return `${minute} ${hour} * * *`;
    case "weekdays":
      return `${minute} ${hour} * * 1-5`;
    case "weekly":
      return `${minute} ${hour} * * ${config.dayOfWeek}`;
    case "monthly":
      return `${minute} ${hour} ${clamp(config.dayOfMonth, 1, 31)} * *`;
    case "custom":
    default:
      return "* * * * *";
  }
}

function ScheduleDropdown({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
}) {
  const selectedLabel = options.find((option) => option.value === value)?.label ?? value;

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] font-medium text-foreground/80">{label}</label>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            buttonVariants({ variant: "outline", size: "lg" }),
            "w-full justify-between px-3 text-[13px] font-normal"
          )}
        >
          <span className="truncate">{selectedLabel}</span>
          <ChevronDown data-icon="inline-end" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuGroup>
            {options.map((option) => {
              const isSelected = option.value === value;

              return (
                <DropdownMenuItem key={option.value} onClick={() => onChange(option.value)}>
                  <Check className={cn(isSelected ? "opacity-100" : "opacity-0")} />
                  <span>{option.label}</span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function getSummaryHint(config: ScheduleConfig): string {
  switch (config.kind) {
    case "minutes":
      return "Runs on a repeating minute interval.";
    case "hours":
      return "Runs at the top of the hour on a repeating hourly interval.";
    case "daily":
      return "Runs once every day at your chosen time.";
    case "weekdays":
      return "Runs Monday through Friday at your chosen time.";
    case "weekly":
      return "Runs once a week on the selected day and time.";
    case "monthly":
      return "Runs once a month on the selected day and time.";
    case "custom":
    default:
      return "Advanced mode for any cron expression.";
  }
}

export function SchedulePicker({ value, onChange, label }: SchedulePickerProps) {
  const parsedConfig = useMemo(() => parseCron(value), [value]);
  const [showCron, setShowCron] = useState(() => parseCron(value).kind === "custom");
  const [customModeValue, setCustomModeValue] = useState<string | null>(null);
  const config = useMemo(
    () => (customModeValue === value ? { ...parsedConfig, kind: "custom" as const } : parsedConfig),
    [customModeValue, parsedConfig, value]
  );
  const isCronVisible = showCron || config.kind === "custom";

  const humanReadable = useMemo(() => cronToHuman(value), [value]);
  const summaryHint = useMemo(() => getSummaryHint(config), [config]);

  const updateConfig = (patch: Partial<ScheduleConfig>) => {
    const nextConfig = { ...config, ...patch };
    setCustomModeValue(null);
    onChange(buildCron(nextConfig));
  };

  const handleKindChange = (nextKind: ScheduleKind) => {
    if (nextKind === "custom") {
      setCustomModeValue(value);
      setShowCron(true);
      return;
    }

    const nextConfig: ScheduleConfig = {
      ...DEFAULT_CONFIG,
      ...config,
      kind: nextKind,
    };

    setCustomModeValue(null);
    onChange(buildCron(nextConfig));
  };

  return (
    <div className="flex flex-col gap-2">
      {label ? (
        <label className="text-[11px] text-muted-foreground uppercase tracking-wide">
          {label}
        </label>
      ) : null}

      <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-muted/20 p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <ScheduleDropdown
            label="Repeats"
            value={config.kind}
            onChange={(nextValue) => handleKindChange(nextValue as ScheduleKind)}
            options={SCHEDULE_KIND_OPTIONS}
          />

          {config.kind === "minutes" ? (
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-foreground/80">Interval</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={59}
                  value={config.minuteInterval}
                  onChange={(event) => updateConfig({ minuteInterval: clamp(Number.parseInt(event.target.value, 10) || 1, 1, 59) })}
                  className="h-9 w-24 rounded-md border border-input bg-background px-3 text-[13px]"
                />
                <span className="text-[12px] text-muted-foreground">minutes</span>
              </div>
            </div>
          ) : null}

          {config.kind === "hours" ? (
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-foreground/80">Interval</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={23}
                  value={config.hourInterval}
                  onChange={(event) => updateConfig({ hourInterval: clamp(Number.parseInt(event.target.value, 10) || 1, 1, 23) })}
                  className="h-9 w-24 rounded-md border border-input bg-background px-3 text-[13px]"
                />
                <span className="text-[12px] text-muted-foreground">hours</span>
              </div>
            </div>
          ) : null}

          {config.kind === "daily" || config.kind === "weekdays" || config.kind === "weekly" || config.kind === "monthly" ? (
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-foreground/80">Time</label>
              <input
                type="time"
                value={config.time}
                onChange={(event) => updateConfig({ time: event.target.value || DEFAULT_CONFIG.time })}
                className="h-9 rounded-md border border-input bg-background px-3 text-[13px]"
              />
            </div>
          ) : null}

          {config.kind === "weekly" ? (
            <ScheduleDropdown
              label="Day"
              value={config.dayOfWeek}
              onChange={(dayOfWeek) => updateConfig({ dayOfWeek })}
              options={DAY_OPTIONS}
            />
          ) : null}

          {config.kind === "monthly" ? (
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-foreground/80">Day of month</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={config.dayOfMonth}
                  onChange={(event) => updateConfig({ dayOfMonth: clamp(Number.parseInt(event.target.value, 10) || 1, 1, 31) })}
                  className="h-9 w-24 rounded-md border border-input bg-background px-3 text-[13px]"
                />
                <span className="text-[12px] text-muted-foreground">each month</span>
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex items-start gap-2 rounded-md bg-background/80 px-3 py-2 text-[12px]">
          <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <div className="flex flex-1 flex-col gap-0.5">
            <span className="font-medium text-foreground">{humanReadable}</span>
            <span className="text-muted-foreground">{summaryHint}</span>
          </div>
        </div>
      </div>

      {config.kind !== "custom" ? (
        <button
          type="button"
          onClick={() => setShowCron((current) => !current)}
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className={cn("h-3 w-3 transition-transform", isCronVisible && "rotate-180")} />
          {isCronVisible ? "Hide advanced cron" : "Show advanced cron"}
        </button>
      ) : null}

      {isCronVisible ? (
        <div className="flex flex-col gap-1.5 rounded-md border border-dashed border-border/60 bg-muted/10 p-3">
          <input
            value={value}
            onChange={(event) => {
              setCustomModeValue(null);
              onChange(event.target.value);
            }}
            placeholder="0 9 * * 1-5"
            className="h-9 rounded-md border border-input bg-background px-3 font-mono text-[12px]"
          />
          <p className="text-[11px] text-muted-foreground">
            Cron format: minute hour day-of-month month day-of-week.
          </p>
        </div>
      ) : null}
    </div>
  );
}
