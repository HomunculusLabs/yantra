import type {
  EditableThemeDefinition,
  ThemeCustomFont,
  ThemeMode,
  ThemeVarKey,
} from "@/types/settings";

export interface ThemeFontOption {
  id: string;
  label: string;
  cssFamily: string;
  googleFamily?: string;
}

export interface RuntimeThemeDefinition extends EditableThemeDefinition {
  accent: string;
  source: "built-in" | "custom";
}

export type ThemeDefinition = RuntimeThemeDefinition;

interface BuiltInThemeSeed {
  name: string;
  label: string;
  type: ThemeMode;
  background: string;
  foreground: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  mutedForeground: string;
  primary: string;
  primaryForeground?: string;
  destructive: string;
  ring?: string;
  bodyFontId?: string | null;
  headingFontId?: string | null;
}

export type StoredThemeSelection =
  | { kind: "default"; mode: ThemeMode }
  | { kind: "theme"; themeName: string };

export const THEME_VAR_KEYS = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-foreground",
  "--destructive",
  "--border",
  "--input",
  "--ring",
  "--sidebar",
  "--sidebar-foreground",
  "--sidebar-primary",
  "--sidebar-primary-foreground",
  "--sidebar-accent",
  "--sidebar-accent-foreground",
  "--sidebar-border",
  "--sidebar-ring",
] as const satisfies readonly ThemeVarKey[];

const THEME_SELECTION_STORAGE_KEY = "yantra-theme-selection";
const LEGACY_THEME_STORAGE_KEY = "yantra-theme";
const NEXT_THEMES_STORAGE_KEY = "theme";
const THEME_FONTS_STYLESHEET_ID = "theme-fonts-link";
const CUSTOM_THEME_FONT_LINK_ATTR = "data-theme-custom-font";

export const DEFAULT_THEME_NAME = "gruvbox-light-medium";
export const DEFAULT_CUSTOM_THEME_NAME = DEFAULT_THEME_NAME;
export const DEFAULT_DARK_THEME_NAME = "gruvbox-dark-medium";

export const THEME_FONT_OPTIONS: ThemeFontOption[] = [
  {
    id: "app-sans",
    label: "App Sans",
    cssFamily: "var(--font-sans), ui-sans-serif, system-ui, sans-serif",
  },
  {
    id: "app-mono",
    label: "App Mono",
    cssFamily: "var(--font-mono), ui-monospace, monospace",
  },
  {
    id: "system-serif",
    label: "System Serif",
    cssFamily: 'Georgia, Cambria, "Times New Roman", Times, serif',
  },
  {
    id: "space-grotesk",
    label: "Space Grotesk",
    cssFamily: "'Space Grotesk', var(--font-sans)",
    googleFamily: "Space Grotesk:wght@400;500;600;700",
  },
  {
    id: "playfair-display",
    label: "Playfair Display",
    cssFamily: "'Playfair Display', Georgia, serif",
    googleFamily: "Playfair Display:wght@400;600;700",
  },
  {
    id: "dm-sans",
    label: "DM Sans",
    cssFamily: "'DM Sans', var(--font-sans)",
    googleFamily: "DM Sans:wght@400;500;600;700",
  },
  {
    id: "unbounded",
    label: "Unbounded",
    cssFamily: "'Unbounded', var(--font-sans)",
    googleFamily: "Unbounded:wght@400;600;700",
  },
  {
    id: "outfit",
    label: "Outfit",
    cssFamily: "'Outfit', var(--font-sans)",
    googleFamily: "Outfit:wght@400;500;600;700",
  },
  {
    id: "syne",
    label: "Syne",
    cssFamily: "'Syne', var(--font-sans)",
    googleFamily: "Syne:wght@400;600;700",
  },
  {
    id: "sora",
    label: "Sora",
    cssFamily: "'Sora', var(--font-sans)",
    googleFamily: "Sora:wght@400;500;600;700",
  },
  {
    id: "bricolage-grotesque",
    label: "Bricolage Grotesque",
    cssFamily: "'Bricolage Grotesque', var(--font-sans)",
    googleFamily: "Bricolage Grotesque:wght@400;600;700",
  },
  {
    id: "plus-jakarta-sans",
    label: "Plus Jakarta Sans",
    cssFamily: "'Plus Jakarta Sans', var(--font-sans)",
    googleFamily: "Plus Jakarta Sans:wght@400;500;600;700",
  },
  {
    id: "fraunces",
    label: "Fraunces",
    cssFamily: "'Fraunces', Georgia, serif",
    googleFamily: "Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700",
  },
  {
    id: "space-mono",
    label: "Space Mono",
    cssFamily: "'Space Mono', var(--font-mono)",
    googleFamily: "Space Mono:wght@400;700",
  },
  {
    id: "orbitron",
    label: "Orbitron",
    cssFamily: "'Orbitron', var(--font-mono)",
    googleFamily: "Orbitron:wght@400;600;700",
  },
  {
    id: "merriweather-sans",
    label: "Merriweather Sans",
    cssFamily: "'Merriweather Sans', var(--font-sans)",
    googleFamily: "Merriweather Sans:wght@400;500;600;700",
  },
  {
    id: "libre-baskerville",
    label: "Libre Baskerville",
    cssFamily: "'Libre Baskerville', Georgia, serif",
    googleFamily: "Libre Baskerville:wght@400;700",
  },
  {
    id: "nunito",
    label: "Nunito",
    cssFamily: "'Nunito', var(--font-sans)",
    googleFamily: "Nunito:wght@400;500;600;700",
  },
  {
    id: "cormorant-garamond",
    label: "Cormorant Garamond",
    cssFamily: "'Cormorant Garamond', Georgia, serif",
    googleFamily: "Cormorant Garamond:wght@400;600;700",
  },
  {
    id: "rubik",
    label: "Rubik",
    cssFamily: "'Rubik', var(--font-sans)",
    googleFamily: "Rubik:wght@400;500;600;700",
  },
  {
    id: "bitter",
    label: "Bitter",
    cssFamily: "'Bitter', Georgia, serif",
    googleFamily: "Bitter:wght@400;600;700",
  },
  {
    id: "figtree",
    label: "Figtree",
    cssFamily: "'Figtree', var(--font-sans)",
    googleFamily: "Figtree:wght@400;500;600;700",
  },
  {
    id: "montserrat",
    label: "Montserrat",
    cssFamily: "'Montserrat', var(--font-sans)",
    googleFamily: "Montserrat:wght@400;600;700",
  },
  {
    id: "quicksand",
    label: "Quicksand",
    cssFamily: "'Quicksand', var(--font-sans)",
    googleFamily: "Quicksand:wght@400;500;600;700",
  },
  {
    id: "spectral",
    label: "Spectral",
    cssFamily: "'Spectral', Georgia, serif",
    googleFamily: "Spectral:wght@400;600;700",
  },
];

function createBuiltInThemeSeed({
  name,
  label,
  type,
  background,
  foreground,
  surface,
  surfaceAlt,
  border,
  mutedForeground,
  primary,
  primaryForeground,
  destructive,
  ring,
  bodyFontId,
  headingFontId,
}: BuiltInThemeSeed): EditableThemeDefinition {
  const resolvedPrimaryForeground = primaryForeground ?? background;
  const resolvedRing = ring ?? primary;

  return {
    name,
    label,
    type,
    bodyFontId: bodyFontId ?? "app-sans",
    headingFontId: headingFontId ?? "app-sans",
    vars: {
      "--background": background,
      "--foreground": foreground,
      "--card": surface,
      "--card-foreground": foreground,
      "--popover": surface,
      "--popover-foreground": foreground,
      "--primary": primary,
      "--primary-foreground": resolvedPrimaryForeground,
      "--secondary": surfaceAlt,
      "--secondary-foreground": foreground,
      "--muted": surfaceAlt,
      "--muted-foreground": mutedForeground,
      "--accent": surfaceAlt,
      "--accent-foreground": foreground,
      "--destructive": destructive,
      "--border": border,
      "--input": border,
      "--ring": resolvedRing,
      "--sidebar": surface,
      "--sidebar-foreground": foreground,
      "--sidebar-primary": primary,
      "--sidebar-primary-foreground": resolvedPrimaryForeground,
      "--sidebar-accent": surfaceAlt,
      "--sidebar-accent-foreground": foreground,
      "--sidebar-border": border,
      "--sidebar-ring": resolvedRing,
    },
  };
}

const BUILT_IN_THEME_SEEDS: EditableThemeDefinition[] = [
  createBuiltInThemeSeed({
    name: "gruvbox-dark-medium",
    label: "Gruvbox Dark Medium",
    type: "dark",
    background: "#282828",
    foreground: "#ebdbb2",
    surface: "#32302f",
    surfaceAlt: "#3c3836",
    border: "#504945",
    mutedForeground: "#a89984",
    primary: "#d79921",
    primaryForeground: "#1d2021",
    destructive: "#fb4934",
    ring: "#83a598",
  }),
  createBuiltInThemeSeed({
    name: "gruvbox-dark-hard",
    label: "Gruvbox Dark Hard",
    type: "dark",
    background: "#1d2021",
    foreground: "#ebdbb2",
    surface: "#282828",
    surfaceAlt: "#32302f",
    border: "#504945",
    mutedForeground: "#a89984",
    primary: "#d79921",
    primaryForeground: "#1d2021",
    destructive: "#fb4934",
    ring: "#83a598",
  }),
  createBuiltInThemeSeed({
    name: "gruvbox-dark-soft",
    label: "Gruvbox Dark Soft",
    type: "dark",
    background: "#32302f",
    foreground: "#ebdbb2",
    surface: "#3c3836",
    surfaceAlt: "#504945",
    border: "#665c54",
    mutedForeground: "#a89984",
    primary: "#d79921",
    primaryForeground: "#1d2021",
    destructive: "#fb4934",
    ring: "#83a598",
  }),
  createBuiltInThemeSeed({
    name: "gruvbox-light-medium",
    label: "Gruvbox Light Medium",
    type: "light",
    background: "#fbf1c7",
    foreground: "#3c3836",
    surface: "#f2e5bc",
    surfaceAlt: "#ebdbb2",
    border: "#d5c4a1",
    mutedForeground: "#7c6f64",
    primary: "#b57614",
    primaryForeground: "#fbf1c7",
    destructive: "#9d0006",
    ring: "#076678",
  }),
  createBuiltInThemeSeed({
    name: "gruvbox-light-hard",
    label: "Gruvbox Light Hard",
    type: "light",
    background: "#f9f5d7",
    foreground: "#3c3836",
    surface: "#fbf1c7",
    surfaceAlt: "#ebdbb2",
    border: "#d5c4a1",
    mutedForeground: "#7c6f64",
    primary: "#b57614",
    primaryForeground: "#f9f5d7",
    destructive: "#9d0006",
    ring: "#076678",
  }),
  createBuiltInThemeSeed({
    name: "gruvbox-light-soft",
    label: "Gruvbox Light Soft",
    type: "light",
    background: "#f2e5bc",
    foreground: "#3c3836",
    surface: "#ebdbb2",
    surfaceAlt: "#d5c4a1",
    border: "#bdae93",
    mutedForeground: "#7c6f64",
    primary: "#b57614",
    primaryForeground: "#f2e5bc",
    destructive: "#9d0006",
    ring: "#076678",
  }),
  createBuiltInThemeSeed({
    name: "everforest",
    label: "Everforest",
    type: "dark",
    background: "#2D353B",
    foreground: "#D3C6AA",
    surface: "#343F44",
    surfaceAlt: "#3D484D",
    border: "#475258",
    mutedForeground: "#859289",
    primary: "#7FBBB3",
    primaryForeground: "#232A2E",
    destructive: "#E67E80",
    ring: "#DBBC7F",
  }),
  createBuiltInThemeSeed({
    name: "catppuccin-latte",
    label: "Catppuccin Latte",
    type: "light",
    background: "#eff1f5",
    foreground: "#4c4f69",
    surface: "#e6e9ef",
    surfaceAlt: "#ccd0da",
    border: "#bcc0cc",
    mutedForeground: "#6c6f85",
    primary: "#1e66f5",
    primaryForeground: "#eff1f5",
    destructive: "#d20f39",
    ring: "#7287fd",
  }),
  createBuiltInThemeSeed({
    name: "catppuccin-frappe",
    label: "Catppuccin Frappé",
    type: "dark",
    background: "#303446",
    foreground: "#c6d0f5",
    surface: "#292c3c",
    surfaceAlt: "#414559",
    border: "#51576d",
    mutedForeground: "#a5adce",
    primary: "#8caaee",
    primaryForeground: "#232634",
    destructive: "#e78284",
    ring: "#babbf1",
  }),
  createBuiltInThemeSeed({
    name: "catppuccin-macchiato",
    label: "Catppuccin Macchiato",
    type: "dark",
    background: "#24273a",
    foreground: "#cad3f5",
    surface: "#1e2030",
    surfaceAlt: "#363a4f",
    border: "#494d64",
    mutedForeground: "#a5adcb",
    primary: "#8aadf4",
    primaryForeground: "#181926",
    destructive: "#ed8796",
    ring: "#b7bdf8",
  }),
  createBuiltInThemeSeed({
    name: "catppuccin-mocha",
    label: "Catppuccin Mocha",
    type: "dark",
    background: "#1e1e2e",
    foreground: "#cdd6f4",
    surface: "#181825",
    surfaceAlt: "#313244",
    border: "#45475a",
    mutedForeground: "#a6adc8",
    primary: "#89b4fa",
    primaryForeground: "#11111b",
    destructive: "#f38ba8",
    ring: "#b4befe",
  }),
  createBuiltInThemeSeed({
    name: "nord",
    label: "Nord",
    type: "dark",
    background: "#2e3440",
    foreground: "#eceff4",
    surface: "#3b4252",
    surfaceAlt: "#434c5e",
    border: "#4c566a",
    mutedForeground: "#d8dee9",
    primary: "#88c0d0",
    primaryForeground: "#2e3440",
    destructive: "#bf616a",
    ring: "#81a1c1",
  }),
  createBuiltInThemeSeed({
    name: "tokyo-night",
    label: "Tokyo Night",
    type: "dark",
    background: "#222436",
    foreground: "#c8d3f5",
    surface: "#1e2030",
    surfaceAlt: "#2f334d",
    border: "#545c7e",
    mutedForeground: "#828bb8",
    primary: "#82aaff",
    primaryForeground: "#191B29",
    destructive: "#ff757f",
    ring: "#c099ff",
  }),
  createBuiltInThemeSeed({
    name: "rose-pine",
    label: "Rose Pine",
    type: "dark",
    background: "#191724",
    foreground: "#e0def4",
    surface: "#1f1d2e",
    surfaceAlt: "#26233a",
    border: "#403d52",
    mutedForeground: "#908caa",
    primary: "#9ccfd8",
    primaryForeground: "#191724",
    destructive: "#eb6f92",
    ring: "#c4a7e7",
  }),
  createBuiltInThemeSeed({
    name: "rose-pine-dawn",
    label: "Rose Pine Dawn",
    type: "light",
    background: "#faf4ed",
    foreground: "#464261",
    surface: "#fffaf3",
    surfaceAlt: "#f2e9e1",
    border: "#dfdad9",
    mutedForeground: "#797593",
    primary: "#56949f",
    primaryForeground: "#faf4ed",
    destructive: "#b4637a",
    ring: "#907aa9",
  }),
];

function toRuntimeTheme(
  theme: EditableThemeDefinition,
  source: RuntimeThemeDefinition["source"]
): RuntimeThemeDefinition {
  return {
    ...theme,
    accent: theme.vars["--primary"],
    source,
    vars: { ...theme.vars },
  };
}

export const BUILT_IN_THEMES: RuntimeThemeDefinition[] = BUILT_IN_THEME_SEEDS.map((theme) =>
  toRuntimeTheme(theme, "built-in")
);

export const THEMES = BUILT_IN_THEMES;

export function slugifyThemeName(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function getThemeFontById(id: string | null | undefined): ThemeFontOption | null {
  if (!id) return null;
  return THEME_FONT_OPTIONS.find((font) => font.id === id) ?? null;
}

export function normalizeCustomThemeFont(font: unknown): ThemeCustomFont | null {
  if (!font || typeof font !== "object" || !("family" in font)) return null;

  const family = typeof font.family === "string" ? font.family.trim() : "";
  if (!family) return null;

  return {
    family,
    importUrl:
      "importUrl" in font && typeof font.importUrl === "string"
        ? font.importUrl.trim() || null
        : null,
  };
}

export function getCustomThemeFontFamily(
  font: ThemeCustomFont | null | undefined,
  fallbackVar = "--font-sans"
): string | null {
  const normalized = normalizeCustomThemeFont(font);
  if (!normalized) return null;

  if (/[,'"]|var\(--/.test(normalized.family)) {
    return normalized.family;
  }

  return `'${normalized.family}', var(${fallbackVar})`;
}

export function getThemeFontFamily(
  id: string | null | undefined,
  customFont?: ThemeCustomFont | null,
  fallbackVar = "--font-sans"
): string | null {
  return getCustomThemeFontFamily(customFont, fallbackVar) ?? getThemeFontById(id)?.cssFamily ?? null;
}

export function ensureThemeFontStylesheet(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(THEME_FONTS_STYLESHEET_ID)) return;

  const families = THEME_FONT_OPTIONS.flatMap((font) =>
    font.googleFamily ? [font.googleFamily] : []
  );
  if (families.length === 0) return;

  const params = new URLSearchParams();
  for (const family of families) {
    params.append("family", family);
  }
  params.set("display", "swap");

  const link = document.createElement("link");
  link.id = THEME_FONTS_STYLESHEET_ID;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?${params.toString()}`;
  document.head.appendChild(link);
}

export function getBuiltInThemeByName(name: string | null | undefined) {
  if (!name) return null;
  return BUILT_IN_THEMES.find((theme) => theme.name === name) ?? null;
}

export function getDefaultBuiltInThemeForType(type: ThemeMode) {
  return getBuiltInThemeByName(type === "dark" ? DEFAULT_DARK_THEME_NAME : DEFAULT_THEME_NAME);
}

export function resolveAvailableThemes(
  customThemes: EditableThemeDefinition[] = []
): RuntimeThemeDefinition[] {
  return [
    ...BUILT_IN_THEMES,
    ...customThemes.map((theme) => toRuntimeTheme(theme, "custom")),
  ];
}

export function getThemeByName(
  name: string | null,
  customThemes: EditableThemeDefinition[] = []
) {
  if (!name) return null;
  return resolveAvailableThemes(customThemes).find((theme) => theme.name === name) ?? null;
}

export function createEditableThemeFromRuntimeTheme(
  theme: RuntimeThemeDefinition
): EditableThemeDefinition {
  return {
    name: theme.name,
    label: theme.label,
    type: theme.type,
    bodyFontId: theme.bodyFontId,
    headingFontId: theme.headingFontId,
    bodyFontCustom: normalizeCustomThemeFont(theme.bodyFontCustom),
    headingFontCustom: normalizeCustomThemeFont(theme.headingFontCustom),
    vars: { ...theme.vars },
  };
}

export function collectThemeFontImportUrls(
  themes: Array<Pick<EditableThemeDefinition, "bodyFontCustom" | "headingFontCustom">>
): string[] {
  const urls = new Set<string>();

  for (const theme of themes) {
    const bodyImport = normalizeCustomThemeFont(theme.bodyFontCustom)?.importUrl;
    const headingImport = normalizeCustomThemeFont(theme.headingFontCustom)?.importUrl;
    if (bodyImport) urls.add(bodyImport);
    if (headingImport) urls.add(headingImport);
  }

  return Array.from(urls);
}

export function syncCustomThemeFontStylesheets(
  themes: Array<Pick<EditableThemeDefinition, "bodyFontCustom" | "headingFontCustom">>
): void {
  if (typeof document === "undefined") return;

  const desiredUrls = new Set(collectThemeFontImportUrls(themes));
  const existingLinks = Array.from(
    document.head.querySelectorAll<HTMLLinkElement>(`link[${CUSTOM_THEME_FONT_LINK_ATTR}="true"]`)
  );

  for (const link of existingLinks) {
    if (!desiredUrls.has(link.href)) {
      link.remove();
    }
  }

  const existingUrls = new Set(existingLinks.map((link) => link.href));
  for (const url of desiredUrls) {
    if (existingUrls.has(url)) continue;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = url;
    link.setAttribute(CUSTOM_THEME_FONT_LINK_ATTR, "true");
    document.head.appendChild(link);
  }
}

function parseStoredThemeSelection(raw: string | null): StoredThemeSelection | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredThemeSelection;
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.kind === "default" &&
      (parsed.mode === "light" || parsed.mode === "dark")
    ) {
      return parsed;
    }
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.kind === "theme" &&
      typeof parsed.themeName === "string" &&
      parsed.themeName.trim()
    ) {
      return { kind: "theme", themeName: parsed.themeName.trim() };
    }
  } catch {
    // ignore malformed storage
  }
  return null;
}

export function readLegacyThemeSelection(): StoredThemeSelection | null {
  if (typeof window === "undefined") return null;

  const legacyThemeName = localStorage.getItem(LEGACY_THEME_STORAGE_KEY)?.trim();
  if (legacyThemeName) {
    return { kind: "theme", themeName: legacyThemeName };
  }

  const nextThemeMode = localStorage.getItem(NEXT_THEMES_STORAGE_KEY);
  if (nextThemeMode === "light" || nextThemeMode === "dark") {
    return { kind: "default", mode: nextThemeMode };
  }

  return null;
}

export function getStoredThemeSelection(): StoredThemeSelection | null {
  if (typeof window === "undefined") return null;

  const structured = parseStoredThemeSelection(
    localStorage.getItem(THEME_SELECTION_STORAGE_KEY)
  );
  if (structured) {
    return structured;
  }

  const legacy = readLegacyThemeSelection();
  if (legacy) {
    storeThemeSelection(legacy);
  }
  return legacy;
}

export function storeThemeSelection(selection: StoredThemeSelection | null): void {
  if (typeof window === "undefined") return;

  if (!selection) {
    localStorage.removeItem(THEME_SELECTION_STORAGE_KEY);
    localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
    return;
  }

  localStorage.setItem(THEME_SELECTION_STORAGE_KEY, JSON.stringify(selection));
  if (selection.kind === "theme") {
    localStorage.setItem(LEGACY_THEME_STORAGE_KEY, selection.themeName);
  } else {
    localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
  }
}

export function getStoredThemeName(): string | null {
  const selection = getStoredThemeSelection();
  return selection?.kind === "theme" ? selection.themeName : null;
}

export function storeThemeName(name: string | null): void {
  storeThemeSelection(name ? { kind: "theme", themeName: name } : null);
}

export function applyTheme(theme: RuntimeThemeDefinition | null) {
  const root = document.documentElement;

  if (!theme) {
    root.removeAttribute("data-custom-theme");
    root.style.removeProperty("--font-theme");
    root.style.removeProperty("--font-heading-theme");
    for (const key of THEME_VAR_KEYS) {
      root.style.removeProperty(key);
    }
    return;
  }

  for (const key of THEME_VAR_KEYS) {
    root.style.setProperty(key, theme.vars[key]);
  }

  const bodyFont = getThemeFontFamily(theme.bodyFontId, theme.bodyFontCustom, "--font-sans");
  const headingFont = getThemeFontFamily(
    theme.headingFontId,
    theme.headingFontCustom,
    "--font-sans"
  );

  if (bodyFont) {
    root.style.setProperty("--font-theme", bodyFont);
  } else {
    root.style.removeProperty("--font-theme");
  }

  if (headingFont) {
    root.style.setProperty("--font-heading-theme", headingFont);
  } else {
    root.style.removeProperty("--font-heading-theme");
  }

  root.setAttribute("data-custom-theme", theme.name);
}
