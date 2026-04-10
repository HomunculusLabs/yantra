import type { SelectedSection } from "@/stores/app-store";

export const HASH_ROUTE_STORAGE_KEY = "yantra.last-route";

export interface HashRouteState {
  section: SelectedSection;
  pagePath: string | null;
}

function encodeHashPath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function decodeHashPath(path: string): string | null {
  const trimmed = path.trim().replace(/^\/+/, "");
  if (!trimmed) return null;

  try {
    return trimmed
      .split("/")
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment))
      .join("/");
  } catch {
    return null;
  }
}

export function buildHashRoute(
  section: SelectedSection,
  pagePath: string | null
): string {
  if (section.type === "page") {
    return pagePath ? `#/page/${encodeHashPath(pagePath)}` : "#/page";
  }
  if (section.type === "agent" && section.slug) {
    return `#/agents/${encodeURIComponent(section.slug)}`;
  }
  if (section.type === "agents") return "#/agents";
  if (section.type === "graph") return "#/graph";
  if (section.type === "jobs") return "#/jobs";
  if (section.type === "settings") return "#/settings";
  return "#/page";
}

export function parseHashRoute(hash: string): HashRouteState | null {
  const raw = hash.replace(/^#\/?/, "").trim();
  if (!raw) {
    return {
      section: { type: "page" },
      pagePath: null,
    };
  }

  if (raw === "page") {
    return {
      section: { type: "page" },
      pagePath: null,
    };
  }

  if (raw.startsWith("page/")) {
    return {
      section: { type: "page" },
      pagePath: decodeHashPath(raw.slice("page/".length)),
    };
  }

  if (raw === "agents") {
    return {
      section: { type: "agents" },
      pagePath: null,
    };
  }

  if (raw.startsWith("agents/")) {
    const slug = decodeURIComponent(raw.slice("agents/".length));
    return slug
      ? {
          section: { type: "agent", slug },
          pagePath: null,
        }
      : null;
  }

  if (raw === "graph") {
    return {
      section: { type: "graph" },
      pagePath: null,
    };
  }

  if (raw === "jobs") {
    return {
      section: { type: "jobs" },
      pagePath: null,
    };
  }

  if (raw === "settings") {
    return {
      section: { type: "settings" },
      pagePath: null,
    };
  }

  return null;
}

export function saveHashRouteToStorage(hash: string): void {
  try {
    window.localStorage.setItem(HASH_ROUTE_STORAGE_KEY, hash);
  } catch {
    // ignore storage failures
  }
}

export function loadHashRouteFromStorage(): string | null {
  try {
    return window.localStorage.getItem(HASH_ROUTE_STORAGE_KEY);
  } catch {
    return null;
  }
}
