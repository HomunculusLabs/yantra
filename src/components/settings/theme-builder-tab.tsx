"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { Copy, Moon, Palette, Plus, Sun, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  BUILT_IN_THEMES,
  DEFAULT_THEME_NAME,
  THEME_FONT_OPTIONS,
  createEditableThemeFromRuntimeTheme,
  getDefaultBuiltInThemeForType,
  getBuiltInThemeByName,
  getThemeFontFamily,
  resolveAvailableThemes,
  slugifyThemeName,
  type RuntimeThemeDefinition,
} from "@/lib/themes";
import { cn } from "@/lib/utils";
import type {
  EditableThemeDefinition,
  ThemeValidationIssue,
  ThemesConfigResponse,
  ThemeVarKey,
} from "@/types/settings";

type ThemeSelectionRef = `built-in:${string}` | `custom:${string}`;

const THEME_VAR_GROUPS: Array<{ title: string; keys: ThemeVarKey[] }> = [
  {
    title: "Surfaces & content",
    keys: [
      "--background",
      "--foreground",
      "--card",
      "--card-foreground",
      "--popover",
      "--popover-foreground",
      "--border",
      "--input",
      "--ring",
    ],
  },
  {
    title: "Actions & semantic",
    keys: [
      "--primary",
      "--primary-foreground",
      "--secondary",
      "--secondary-foreground",
      "--muted",
      "--muted-foreground",
      "--accent",
      "--accent-foreground",
      "--destructive",
    ],
  },
  {
    title: "Sidebar",
    keys: [
      "--sidebar",
      "--sidebar-foreground",
      "--sidebar-primary",
      "--sidebar-primary-foreground",
      "--sidebar-accent",
      "--sidebar-accent-foreground",
      "--sidebar-border",
      "--sidebar-ring",
    ],
  },
];

function formatVarLabel(key: ThemeVarKey) {
  return key.replace(/^--/, "").replace(/-/g, " ");
}

function buildThemeSelection(theme: RuntimeThemeDefinition): ThemeSelectionRef {
  return `${theme.source}:${theme.name}`;
}

function buildCustomSelection(theme: EditableThemeDefinition): ThemeSelectionRef {
  return `custom:${theme.name}`;
}

function cloneTheme(theme: EditableThemeDefinition): EditableThemeDefinition {
  return {
    ...theme,
    bodyFontCustom: theme.bodyFontCustom ? { ...theme.bodyFontCustom } : null,
    headingFontCustom: theme.headingFontCustom ? { ...theme.headingFontCustom } : null,
    vars: { ...theme.vars },
  };
}

function getExistingNames(themes: EditableThemeDefinition[]) {
  return new Set([
    ...BUILT_IN_THEMES.map((theme) => theme.name.toLowerCase()),
    ...themes.map((theme) => theme.name.toLowerCase()),
  ]);
}

function getExistingLabels(themes: EditableThemeDefinition[]) {
  return new Set([
    ...BUILT_IN_THEMES.map((theme) => theme.label.toLowerCase()),
    ...themes.map((theme) => theme.label.toLowerCase()),
  ]);
}

function makeUniqueThemeName(baseLabel: string, themes: EditableThemeDefinition[]) {
  const existing = getExistingNames(themes);
  const base = slugifyThemeName(baseLabel) || "custom-theme";
  let candidate = base;
  let suffix = 2;
  while (existing.has(candidate.toLowerCase())) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function makeUniqueThemeLabel(baseLabel: string, themes: EditableThemeDefinition[]) {
  const existing = getExistingLabels(themes);
  let candidate = baseLabel.trim() || "Custom Theme";
  let suffix = 2;
  while (existing.has(candidate.toLowerCase())) {
    candidate = `${baseLabel.trim() || "Custom Theme"} ${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function makeCustomTheme(
  source: RuntimeThemeDefinition,
  themes: EditableThemeDefinition[],
  preferredLabel?: string
): EditableThemeDefinition {
  const labelBase = preferredLabel?.trim() || `${source.label} Copy`;
  const next = createEditableThemeFromRuntimeTheme(source);
  return {
    ...next,
    name: makeUniqueThemeName(labelBase, themes),
    label: makeUniqueThemeLabel(labelBase, themes),
  };
}

function buildPreviewStyle(theme: RuntimeThemeDefinition): CSSProperties {
  const style: Record<string, string> = { ...theme.vars };
  const bodyFont = getThemeFontFamily(theme.bodyFontId, theme.bodyFontCustom, "--font-sans");
  const headingFont = getThemeFontFamily(
    theme.headingFontId,
    theme.headingFontCustom,
    "--font-sans"
  );
  if (bodyFont) {
    style["--font-theme"] = bodyFont;
  }
  if (headingFont) {
    style["--font-heading-theme"] = headingFont;
  }
  return style as CSSProperties;
}

export function ThemeBuilderTab({
  loading,
  config,
  error,
  validationIssues,
  onChange,
}: {
  loading: boolean;
  config: ThemesConfigResponse | null;
  error?: string | null;
  validationIssues?: ThemeValidationIssue[];
  onChange: (next: ThemesConfigResponse) => void;
}) {
  const defaultBuiltInTheme = getBuiltInThemeByName(DEFAULT_THEME_NAME) ?? BUILT_IN_THEMES[0];
  const [selectedThemeRef, setSelectedThemeRef] = useState<ThemeSelectionRef>(
    `built-in:${defaultBuiltInTheme?.name ?? DEFAULT_THEME_NAME}`
  );

  const allThemes = useMemo(
    () => resolveAvailableThemes(config?.themes ?? []),
    [config?.themes]
  );

  const effectiveSelectedThemeRef = useMemo<ThemeSelectionRef>(() => {
    if (allThemes.some((theme) => buildThemeSelection(theme) === selectedThemeRef)) {
      return selectedThemeRef;
    }
    if (config?.themes[0]) {
      return buildCustomSelection(config.themes[0]);
    }
    return buildThemeSelection(defaultBuiltInTheme);
  }, [allThemes, config, defaultBuiltInTheme, selectedThemeRef]);

  const selectedTheme = useMemo(
    () =>
      allThemes.find((theme) => buildThemeSelection(theme) === effectiveSelectedThemeRef) ?? null,
    [allThemes, effectiveSelectedThemeRef]
  );

  const selectedCustomTheme = useMemo(() => {
    if (!config || !effectiveSelectedThemeRef.startsWith("custom:")) return null;
    const themeName = effectiveSelectedThemeRef.slice("custom:".length);
    return config.themes.find((theme) => theme.name === themeName) ?? null;
  }, [config, effectiveSelectedThemeRef]);

  if (loading) {
    return <div className="text-[12px] text-muted-foreground">Loading theme settings...</div>;
  }

  if (!config) {
    return <div className="text-[12px] text-muted-foreground">Theme settings are unavailable.</div>;
  }

  const updateCustomTheme = (
    themeName: string,
    updater: (theme: EditableThemeDefinition) => EditableThemeDefinition
  ) => {
    onChange({
      ...config,
      themes: config.themes.map((theme) =>
        theme.name === themeName ? cloneTheme(updater(theme)) : cloneTheme(theme)
      ),
    });
  };

  const addTheme = (type: "light" | "dark") => {
    const source = getDefaultBuiltInThemeForType(type) ?? BUILT_IN_THEMES[0];
    if (!source) return;
    const created = makeCustomTheme(
      source,
      config.themes,
      type === "light" ? "Custom Light Theme" : "Custom Dark Theme"
    );
    onChange({
      ...config,
      themes: [...config.themes.map(cloneTheme), created],
    });
    setSelectedThemeRef(buildCustomSelection(created));
  };

  const duplicateTheme = (theme: RuntimeThemeDefinition) => {
    const created = makeCustomTheme(theme, config.themes);
    onChange({
      ...config,
      themes: [...config.themes.map(cloneTheme), created],
    });
    setSelectedThemeRef(buildCustomSelection(created));
  };

  const deleteCustomTheme = (themeName: string) => {
    const nextThemes = config.themes.filter((theme) => theme.name !== themeName).map(cloneTheme);
    onChange({
      ...config,
      themes: nextThemes,
    });
  };

  const previewStyle = selectedTheme ? buildPreviewStyle(selectedTheme) : undefined;
  const previewFontImports = Array.from(
    new Set(
      [selectedCustomTheme?.bodyFontCustom?.importUrl, selectedCustomTheme?.headingFontCustom?.importUrl]
        .filter((value): value is string => Boolean(value))
    )
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-col gap-2">
          <div>
            <h3 className="text-[14px] font-semibold">Theme builder</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Built-in themes stay read-only. Duplicate them or start from a light/dark base to
              create saved themes in a simple config file.
            </p>
          </div>
          {config.configPath ? (
            <p className="text-[11px] text-muted-foreground">Config file: {config.configPath}</p>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-[12px] text-red-200">
          {error}
        </div>
      ) : null}

      {validationIssues && validationIssues.length > 0 ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-[12px] text-amber-100">
          <p className="font-medium">Theme validation issues</p>
          <ul className="mt-2 flex flex-col gap-1">
            {validationIssues.map((issue) => (
              <li key={`${issue.path}:${issue.message}`}>
                <span className="font-mono text-[11px] text-amber-200">{issue.path}</span>
                {": "}
                <span>{issue.message}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
          <div className="flex flex-col gap-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Create a saved theme
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => addTheme("light")}>
                <Plus data-icon="inline-start" />
                New light theme
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => addTheme("dark")}>
                <Plus data-icon="inline-start" />
                New dark theme
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Built-in themes
            </div>
            <div className="flex flex-col gap-2">
              {BUILT_IN_THEMES.map((theme) => (
                <button
                  key={theme.name}
                  type="button"
                  onClick={() => setSelectedThemeRef(buildThemeSelection(theme))}
                  className={cn(
                    "flex items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors",
                    effectiveSelectedThemeRef === buildThemeSelection(theme)
                      ? "border-primary/40 bg-primary/10"
                      : "border-border bg-background hover:bg-accent/40"
                  )}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div
                      className={cn(
                        "size-3 shrink-0 rounded-full border",
                        theme.type === "dark" ? "border-white/20" : "border-black/20"
                      )}
                      style={{ backgroundColor: theme.accent }}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium">{theme.label}</p>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {theme.type}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Saved themes
            </div>
            <div className="flex flex-col gap-2">
              {config.themes.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-3 py-4 text-[12px] text-muted-foreground">
                  No saved themes yet.
                </div>
              ) : (
                config.themes.map((theme) => (
                  <button
                    key={theme.name}
                    type="button"
                    onClick={() => setSelectedThemeRef(buildCustomSelection(theme))}
                    className={cn(
                      "flex items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors",
                      effectiveSelectedThemeRef === buildCustomSelection(theme)
                        ? "border-primary/40 bg-primary/10"
                        : "border-border bg-background hover:bg-accent/40"
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        className={cn(
                          "size-3 shrink-0 rounded-full border",
                          theme.type === "dark" ? "border-white/20" : "border-black/20"
                        )}
                        style={{ backgroundColor: theme.vars["--primary"] }}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium">{theme.label}</p>
                        <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
                          {theme.type} · {theme.name}
                        </p>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          {selectedTheme ? (
            <>
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {selectedTheme.source === "built-in" ? "Built-in theme" : "Saved theme"}
                    </p>
                    <h4 className="mt-1 text-[16px] font-semibold">{selectedTheme.label}</h4>
                    <p className="mt-1 text-[12px] text-muted-foreground">
                      {selectedTheme.type === "dark" ? "Dark mode" : "Light mode"}
                      {selectedTheme.source === "custom" ? ` · ${selectedTheme.name}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => duplicateTheme(selectedTheme)}
                    >
                      <Copy data-icon="inline-start" />
                      Duplicate as custom
                    </Button>
                    {selectedCustomTheme ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => deleteCustomTheme(selectedCustomTheme.name)}
                      >
                        <Trash2 data-icon="inline-start" />
                        Delete theme
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>

              {selectedCustomTheme ? (
                <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_320px]">
                  <div className="rounded-lg border border-border bg-card p-4">
                    <div className="flex flex-col gap-4">
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <label className="flex flex-col gap-2">
                          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            Theme label
                          </span>
                          <Input
                            value={selectedCustomTheme.label}
                            onChange={(event) =>
                              updateCustomTheme(selectedCustomTheme.name, (theme) => ({
                                ...theme,
                                label: event.target.value,
                              }))
                            }
                          />
                        </label>

                        <div className="flex flex-col gap-2">
                          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            Theme mode
                          </span>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant={selectedCustomTheme.type === "light" ? "default" : "outline"}
                              onClick={() =>
                                updateCustomTheme(selectedCustomTheme.name, (theme) => ({
                                  ...theme,
                                  type: "light",
                                }))
                              }
                            >
                              <Sun data-icon="inline-start" />
                              Light
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant={selectedCustomTheme.type === "dark" ? "default" : "outline"}
                              onClick={() =>
                                updateCustomTheme(selectedCustomTheme.name, (theme) => ({
                                  ...theme,
                                  type: "dark",
                                }))
                              }
                            >
                              <Moon data-icon="inline-start" />
                              Dark
                            </Button>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <label className="flex flex-col gap-2">
                          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            Body font
                          </span>
                          <select
                            value={selectedCustomTheme.bodyFontCustom ? "__custom__" : selectedCustomTheme.bodyFontId ?? ""}
                            onChange={(event) =>
                              updateCustomTheme(selectedCustomTheme.name, (theme) => ({
                                ...theme,
                                bodyFontId:
                                  event.target.value && event.target.value !== "__custom__"
                                    ? event.target.value
                                    : null,
                                bodyFontCustom:
                                  event.target.value === "__custom__"
                                    ? theme.bodyFontCustom ?? { family: "", importUrl: "" }
                                    : null,
                              }))
                            }
                            className="h-9 rounded-md border border-input bg-background px-3 text-[13px]"
                          >
                            <option value="">App default</option>
                            <option value="__custom__">Custom Google font</option>
                            {THEME_FONT_OPTIONS.map((font) => (
                              <option key={font.id} value={font.id}>
                                {font.label}
                              </option>
                            ))}
                          </select>
                          {selectedCustomTheme.bodyFontCustom ? (
                            <div className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3">
                              <Input
                                value={selectedCustomTheme.bodyFontCustom.family}
                                onChange={(event) =>
                                  updateCustomTheme(selectedCustomTheme.name, (theme) => ({
                                    ...theme,
                                    bodyFontCustom: {
                                      family: event.target.value,
                                      importUrl: theme.bodyFontCustom?.importUrl ?? "",
                                    },
                                  }))
                                }
                                placeholder="Inter Tight"
                              />
                              <Input
                                value={selectedCustomTheme.bodyFontCustom.importUrl ?? ""}
                                onChange={(event) =>
                                  updateCustomTheme(selectedCustomTheme.name, (theme) => ({
                                    ...theme,
                                    bodyFontCustom: {
                                      family: theme.bodyFontCustom?.family ?? "",
                                      importUrl: event.target.value,
                                    },
                                  }))
                                }
                                placeholder="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;600;700&display=swap"
                                spellCheck={false}
                              />
                            </div>
                          ) : null}
                        </label>

                        <label className="flex flex-col gap-2">
                          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            Heading font
                          </span>
                          <select
                            value={selectedCustomTheme.headingFontCustom ? "__custom__" : selectedCustomTheme.headingFontId ?? ""}
                            onChange={(event) =>
                              updateCustomTheme(selectedCustomTheme.name, (theme) => ({
                                ...theme,
                                headingFontId:
                                  event.target.value && event.target.value !== "__custom__"
                                    ? event.target.value
                                    : null,
                                headingFontCustom:
                                  event.target.value === "__custom__"
                                    ? theme.headingFontCustom ?? { family: "", importUrl: "" }
                                    : null,
                              }))
                            }
                            className="h-9 rounded-md border border-input bg-background px-3 text-[13px]"
                          >
                            <option value="">Match body font</option>
                            <option value="__custom__">Custom Google font</option>
                            {THEME_FONT_OPTIONS.map((font) => (
                              <option key={font.id} value={font.id}>
                                {font.label}
                              </option>
                            ))}
                          </select>
                          {selectedCustomTheme.headingFontCustom ? (
                            <div className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3">
                              <Input
                                value={selectedCustomTheme.headingFontCustom.family}
                                onChange={(event) =>
                                  updateCustomTheme(selectedCustomTheme.name, (theme) => ({
                                    ...theme,
                                    headingFontCustom: {
                                      family: event.target.value,
                                      importUrl: theme.headingFontCustom?.importUrl ?? "",
                                    },
                                  }))
                                }
                                placeholder="Playfair Display"
                              />
                              <Input
                                value={selectedCustomTheme.headingFontCustom.importUrl ?? ""}
                                onChange={(event) =>
                                  updateCustomTheme(selectedCustomTheme.name, (theme) => ({
                                    ...theme,
                                    headingFontCustom: {
                                      family: theme.headingFontCustom?.family ?? "",
                                      importUrl: event.target.value,
                                    },
                                  }))
                                }
                                placeholder="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&display=swap"
                                spellCheck={false}
                              />
                            </div>
                          ) : null}
                        </label>
                      </div>

                      <div className="flex flex-col gap-3">
                        <div>
                          <h5 className="text-[13px] font-medium">Theme tokens</h5>
                          <p className="mt-1 text-[12px] text-muted-foreground">
                            Edit the underlying CSS tokens directly. Changes are saved into the
                            theme config file when you hit Save.
                          </p>
                        </div>
                        <ScrollArea className="h-[420px] rounded-lg border border-border">
                          <div className="flex flex-col gap-4 p-4">
                            {THEME_VAR_GROUPS.map((group) => (
                              <div key={group.title} className="flex flex-col gap-3">
                                <h6 className="text-[11px] uppercase tracking-wide text-muted-foreground">
                                  {group.title}
                                </h6>
                                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                  {group.keys.map((key) => (
                                    <label key={key} className="flex flex-col gap-2">
                                      <span className="text-[11px] capitalize text-muted-foreground">
                                        {formatVarLabel(key)}
                                      </span>
                                      <Input
                                        value={selectedCustomTheme.vars[key]}
                                        onChange={(event) =>
                                          updateCustomTheme(selectedCustomTheme.name, (theme) => ({
                                            ...theme,
                                            vars: {
                                              ...theme.vars,
                                              [key]: event.target.value,
                                            },
                                          }))
                                        }
                                        spellCheck={false}
                                      />
                                    </label>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border bg-card p-4">
                    <div className="flex flex-col gap-3">
                      <div>
                        <h5 className="text-[13px] font-medium">Live preview</h5>
                        <p className="mt-1 text-[12px] text-muted-foreground">
                          Preview uses the draft theme locally without changing the global app theme.
                        </p>
                      </div>
                      <div
                        className="overflow-hidden rounded-xl border border-border bg-background text-foreground"
                        style={previewStyle}
                      >
                        {previewFontImports.length > 0 ? (
                          <style>{previewFontImports.map((url) => `@import url("${url}");`).join("\n")}</style>
                        ) : null}
                        <div className="grid grid-cols-[88px_minmax(0,1fr)]">
                          <div className="bg-sidebar px-3 py-4 text-sidebar-foreground">
                            <div className="flex flex-col gap-2 text-[11px]">
                              <div className="rounded-md bg-sidebar-primary px-2 py-1 text-sidebar-primary-foreground">
                                Brand
                              </div>
                              <div className="rounded-md bg-sidebar-accent px-2 py-1 text-sidebar-accent-foreground">
                                Sidebar
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-col gap-3 p-4">
                            <div>
                              <div
                                className="text-[18px] font-semibold"
                                style={{
                                  fontFamily:
                                    getThemeFontFamily(
                                      selectedTheme.headingFontId,
                                      selectedTheme.headingFontCustom,
                                      "--font-sans"
                                    ) ?? undefined,
                                }}
                              >
                                Yantra Theme
                              </div>
                              <p className="mt-1 text-[12px] text-muted-foreground">
                                Quick visual preview for typography, surfaces, and action colors.
                              </p>
                            </div>
                            <div className="rounded-lg border border-border bg-card p-3 text-card-foreground">
                              <p className="text-[12px] font-medium">Card surface</p>
                              <p className="mt-1 text-[12px] text-muted-foreground">
                                Primary, secondary, muted, and sidebar tokens are all represented.
                              </p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <Button type="button" size="sm">Primary action</Button>
                                <Button type="button" size="sm" variant="secondary">
                                  Secondary action
                                </Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-border bg-card p-4">
                  <div className="flex flex-col gap-3">
                    <p className="text-[13px] text-muted-foreground">
                      Built-in themes are read-only. Duplicate one to create a saved theme you can
                      edit and persist.
                    </p>
                    <div
                      className="overflow-hidden rounded-xl border border-border bg-background text-foreground"
                      style={previewStyle}
                    >
                      <div className="grid grid-cols-[88px_minmax(0,1fr)]">
                        <div className="bg-sidebar px-3 py-4 text-sidebar-foreground">
                          <div className="flex flex-col gap-2 text-[11px]">
                            <div className="rounded-md bg-sidebar-primary px-2 py-1 text-sidebar-primary-foreground">
                              Built-in
                            </div>
                            <div className="rounded-md bg-sidebar-accent px-2 py-1 text-sidebar-accent-foreground">
                              {selectedTheme.type}
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-col gap-3 p-4">
                          <div>
                            <div
                              className="text-[18px] font-semibold"
                              style={{ fontFamily: getThemeFontFamily(selectedTheme.headingFontId) ?? undefined }}
                            >
                              {selectedTheme.label}
                            </div>
                            <p className="mt-1 text-[12px] text-muted-foreground">
                              Duplicate this built-in theme to make it editable.
                            </p>
                          </div>
                          <div className="rounded-lg border border-border bg-card p-3 text-card-foreground">
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => duplicateTheme(selectedTheme)}
                              >
                                <Palette data-icon="inline-start" />
                                Create editable copy
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
