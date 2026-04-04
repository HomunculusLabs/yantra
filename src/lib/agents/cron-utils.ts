/**
 * Human-readable cron expression formatting.
 * Shared between schedule-picker, agent-detail-panel, and agent-card.
 */

const KNOWN_PRESETS: Record<string, string> = {
  "*/5 * * * *": "Every 5 minutes",
  "*/15 * * * *": "Every 15 minutes",
  "*/30 * * * *": "Every 30 minutes",
  "0 * * * *": "Every hour",
  "0 */4 * * *": "Every 4 hours",
  "0 9 * * *": "Daily at 9:00 AM",
  "0 9 * * 1-5": "Weekdays at 9:00 AM",
  "0 9 * * 1": "Every Monday at 9:00 AM",
  "0 9 1 * *": "Monthly on the 1st at 9:00 AM",
};

const DAY_NAMES: Record<string, string> = {
  "0": "Sunday",
  "1": "Monday",
  "2": "Tuesday",
  "3": "Wednesday",
  "4": "Thursday",
  "5": "Friday",
  "6": "Saturday",
  "7": "Sunday",
};

function isIntegerFieldWithin(value: string, min: number, max: number): boolean {
  if (!/^\d+$/.test(value)) return false;
  const parsed = Number.parseInt(value, 10);
  return parsed >= min && parsed <= max;
}

function formatTime(hour: string, minute: string): string {
  const hourNum = Number.parseInt(hour, 10);
  const minuteNum = Number.parseInt(minute, 10);
  const ampm = hourNum >= 12 ? "PM" : "AM";
  const h12 = hourNum % 12 || 12;
  return `${h12}:${String(minuteNum).padStart(2, "0")} ${ampm}`;
}

function toOrdinal(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;

  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

export function cronToHuman(cron: string): string {
  if (KNOWN_PRESETS[cron]) return KNOWN_PRESETS[cron];

  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;

  const [min, hour, dayOfMonth, month, dayOfWeek] = parts;

  if (min.startsWith("*/") && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    const n = Number.parseInt(min.slice(2), 10);
    if (!Number.isFinite(n) || n < 1 || n > 59) return cron;
    return `Every ${n} minute${n === 1 ? "" : "s"}`;
  }

  if (min === "0" && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return "Every hour";
  }

  if (min === "0" && hour.startsWith("*/") && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    const n = Number.parseInt(hour.slice(2), 10);
    if (!Number.isFinite(n) || n < 1 || n > 23) return cron;
    return `Every ${n} hour${n === 1 ? "" : "s"}`;
  }

  const hasSpecificTime = isIntegerFieldWithin(min, 0, 59) && isIntegerFieldWithin(hour, 0, 23);
  if (!hasSpecificTime) return cron;

  const time = formatTime(hour, min);

  if (dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return `Daily at ${time}`;
  }

  if (dayOfMonth === "*" && month === "*" && dayOfWeek === "1-5") {
    return `Weekdays at ${time}`;
  }

  if (dayOfMonth === "*" && month === "*" && dayOfWeek === "0,6") {
    return `Weekends at ${time}`;
  }

  if (dayOfMonth === "*" && month === "*" && DAY_NAMES[dayOfWeek]) {
    return `Every ${DAY_NAMES[dayOfWeek]} at ${time}`;
  }

  if (isIntegerFieldWithin(dayOfMonth, 1, 31) && month === "*" && dayOfWeek === "*") {
    return `Monthly on the ${toOrdinal(Number.parseInt(dayOfMonth, 10))} at ${time}`;
  }

  return cron;
}

/** Short label for use in agent cards (e.g., "15m", "4h", "Daily 9am") */
export function cronToShortLabel(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;

  const [min, hour, dayOfMonth, month, dayOfWeek] = parts;

  if (min.startsWith("*/") && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return `${min.slice(2)}m`;
  }

  if (min === "0" && hour.startsWith("*/") && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return `${hour.slice(2)}h`;
  }

  if (min === "0" && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return "1h";
  }

  if (isIntegerFieldWithin(min, 0, 59) && isIntegerFieldWithin(hour, 0, 23)) {
    const hourNum = Number.parseInt(hour, 10);
    const minuteNum = Number.parseInt(min, 10);
    const ampm = hourNum >= 12 ? "pm" : "am";
    const h12 = hourNum % 12 || 12;
    const minuteSuffix = minuteNum === 0 ? "" : `:${String(minuteNum).padStart(2, "0")}`;

    if (dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
      return `${h12}${minuteSuffix}${ampm}`;
    }

    if (dayOfMonth === "*" && month === "*" && dayOfWeek === "1-5") {
      return `wkdy ${h12}${minuteSuffix}${ampm}`;
    }
  }

  return cron;
}
