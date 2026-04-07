import { describe, expect, test } from "bun:test";
import { shouldRememberPreviousSection } from "@/components/layout/app-shell-state";
import type { SelectedSection } from "@/stores/app-store";

function section(value: SelectedSection): SelectedSection {
  return value;
}

describe("shouldRememberPreviousSection", () => {
  test("does not remember settings sections", () => {
    expect(
      shouldRememberPreviousSection(section({ type: "settings", settingsTab: "plugins" }), null)
    ).toBe(false);
  });

  test("does not remember plugin sections opened from settings", () => {
    expect(
      shouldRememberPreviousSection(
        section({ type: "plugin", pluginEntryKey: "entry", pluginViewId: "main" }),
        section({ type: "settings", settingsTab: "plugins" })
      )
    ).toBe(false);
  });

  test("does remember plugin sections opened from non-settings sections", () => {
    expect(
      shouldRememberPreviousSection(
        section({ type: "plugin", pluginEntryKey: "entry", pluginViewId: "main" }),
        section({ type: "jobs" })
      )
    ).toBe(true);
  });

  test("does remember ordinary workspace sections", () => {
    expect(shouldRememberPreviousSection(section({ type: "page" }), null)).toBe(true);
    expect(shouldRememberPreviousSection(section({ type: "jobs" }), null)).toBe(true);
    expect(shouldRememberPreviousSection(section({ type: "graph" }), null)).toBe(true);
  });
});
