import path from "path";
import matter from "gray-matter";
import { getYantraRoots } from "@/lib/config/yantra-roots";
import { fileExists, listDirectory, readFileContent } from "@/lib/storage/fs-operations";
import { isHiddenEntry, virtualPathFromFs } from "@/lib/storage/path-utils";
import {
  encodeDataviewAttribute,
} from "@/lib/markdown/dataview-shared";

type DataviewQueryType = "table" | "list";
type SortDirection = "asc" | "desc";

interface DataviewPage {
  path: string;
  folder: string;
  name: string;
  title: string;
  tags: string[];
  created?: string;
  modified?: string;
  icon?: string;
  order?: number;
  body: string;
  frontmatter: Record<string, unknown>;
}

interface DataviewColumn {
  expression: string;
  label: string;
}

interface DataviewFilter {
  type: "comparison" | "contains";
  field: string;
  operator?: "=" | "!=" | ">" | ">=" | "<" | "<=";
  value: unknown;
}

interface DataviewQuery {
  type: DataviewQueryType;
  columns: DataviewColumn[];
  listExpression?: string;
  source?: string;
  sourceTag?: string;
  filters: DataviewFilter[];
  sort?: {
    field: string;
    direction: SortDirection;
  };
  limit?: number;
}

function parseFrontmatterSafely(raw: string): {
  data: Record<string, unknown>;
  content: string;
} {
  try {
    const parsed = matter(raw);
    return {
      data: parsed.data,
      content: parsed.content,
    };
  } catch {
    return {
      data: {},
      content: raw,
    };
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeVirtualPath(input: string): string {
  const normalized = input.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized || normalized === ".") return "";
  return path.posix.normalize(normalized).replace(/^\/+|\/+$/g, "");
}

function currentPageFolder(pagePath?: string): string {
  if (!pagePath) return "";
  if (pagePath.endsWith(".md")) {
    const dirname = path.posix.dirname(pagePath);
    return dirname === "." ? "" : dirname;
  }
  return normalizeVirtualPath(pagePath);
}

function splitCommaSeparated(input: string): string[] {
  const result: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;
  let parenDepth = 0;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if ((char === "\"" || char === "'") && input[index - 1] !== "\\") {
      if (quote === char) {
        quote = null;
      } else if (!quote) {
        quote = char;
      }
      current += char;
      continue;
    }

    if (!quote && char === "(") {
      parenDepth += 1;
      current += char;
      continue;
    }

    if (!quote && char === ")" && parenDepth > 0) {
      parenDepth -= 1;
      current += char;
      continue;
    }

    if (char === "," && !quote && parenDepth === 0) {
      if (current.trim()) result.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    result.push(current.trim());
  }

  return result;
}

function splitAndConditions(input: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if ((char === "\"" || char === "'") && input[index - 1] !== "\\") {
      if (quote === char) {
        quote = null;
      } else if (!quote) {
        quote = char;
      }
      current += char;
      continue;
    }

    if (!quote && input.slice(index, index + 5).toUpperCase() === " AND ") {
      if (current.trim()) parts.push(current.trim());
      current = "";
      index += 4;
      continue;
    }

    current += char;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseLiteral(value: string): unknown {
  const trimmed = value.trim();

  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  if (/^(true|false)$/i.test(trimmed)) {
    return trimmed.toLowerCase() === "true";
  }

  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  return trimmed;
}

function parseColumn(columnText: string): DataviewColumn {
  const aliasMatch = columnText.match(/^(.*?)\s+AS\s+(.+)$/i);
  if (!aliasMatch) {
    return {
      expression: columnText.trim(),
      label: columnText.trim(),
    };
  }

  return {
    expression: aliasMatch[1].trim(),
    label: aliasMatch[2].trim().replace(/^["']|["']$/g, ""),
  };
}

function resolveSourceValue(rawValue: string, pagePath?: string): {
  source?: string;
  sourceTag?: string;
} {
  const value = String(parseLiteral(rawValue) ?? "").trim();
  if (!value) return {};

  if (value.startsWith("#")) {
    return { sourceTag: value.slice(1).trim().toLowerCase() };
  }

  if (value.startsWith("./") || value.startsWith("../")) {
    const folder = currentPageFolder(pagePath);
    return {
      source: normalizeVirtualPath(path.posix.join(folder, value)),
    };
  }

  return { source: normalizeVirtualPath(value) };
}

function parseFilter(expression: string): DataviewFilter {
  const containsMatch = expression.match(/^contains\((.+?),\s*(.+)\)$/i);
  if (containsMatch) {
    return {
      type: "contains",
      field: containsMatch[1].trim(),
      value: parseLiteral(containsMatch[2]),
    };
  }

  const comparisonMatch = expression.match(/^(.+?)\s*(>=|<=|!=|=|>|<)\s*(.+)$/);
  if (!comparisonMatch) {
    throw new Error(`Unsupported WHERE clause: ${expression}`);
  }

  return {
    type: "comparison",
    field: comparisonMatch[1].trim(),
    operator: comparisonMatch[2] as DataviewFilter["operator"],
    value: parseLiteral(comparisonMatch[3]),
  };
}

function parseDataviewQuery(source: string, pagePath?: string): DataviewQuery {
  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    throw new Error("Empty dataview block");
  }

  const [firstLine, ...restLines] = lines;
  const typeMatch = firstLine.match(/^(TABLE|LIST)\b/i);
  if (!typeMatch) {
    throw new Error("Only TABLE and LIST dataview queries are supported");
  }

  const type = typeMatch[1].toLowerCase() as DataviewQueryType;
  let remainder = firstLine.slice(typeMatch[0].length).trim();

  if (type === "table") {
    remainder = remainder.replace(/^WITHOUT\s+ID\b/i, "").trim();
  }

  const clauses: string[] = [];
  let columnsPart = "";
  let listExpression = "";

  const inlineClauseMatch = remainder.match(/\b(FROM|WHERE|SORT|LIMIT)\b/i);
  const inlineIndex = inlineClauseMatch?.index ?? -1;
  const headPart = inlineIndex >= 0 ? remainder.slice(0, inlineIndex).trim() : remainder;
  const inlineClausePart = inlineIndex >= 0 ? remainder.slice(inlineIndex).trim() : "";

  if (type === "table") {
    columnsPart = headPart;
  } else if (headPart) {
    listExpression = headPart;
  }

  if (inlineClausePart) clauses.push(inlineClausePart);
  clauses.push(...restLines);

  const query: DataviewQuery = {
    type,
    columns: type === "table" && columnsPart
      ? splitCommaSeparated(columnsPart).map(parseColumn)
      : [],
    listExpression: type === "list" ? listExpression || "file.link" : undefined,
    filters: [],
  };

  for (const clause of clauses) {
    if (/^FROM\b/i.test(clause)) {
      Object.assign(query, resolveSourceValue(clause.replace(/^FROM\b/i, "").trim(), pagePath));
      continue;
    }

    if (/^WHERE\b/i.test(clause)) {
      const rawWhere = clause.replace(/^WHERE\b/i, "").trim();
      query.filters.push(...splitAndConditions(rawWhere).map(parseFilter));
      continue;
    }

    if (/^SORT\b/i.test(clause)) {
      const sortMatch = clause
        .replace(/^SORT\b/i, "")
        .trim()
        .match(/^(.+?)(?:\s+(ASC|DESC))?$/i);
      if (!sortMatch) {
        throw new Error(`Unsupported SORT clause: ${clause}`);
      }
      query.sort = {
        field: sortMatch[1].trim(),
        direction: (sortMatch[2]?.toLowerCase() as SortDirection | undefined) || "asc",
      };
      continue;
    }

    if (/^LIMIT\b/i.test(clause)) {
      const limit = Number(clause.replace(/^LIMIT\b/i, "").trim());
      if (!Number.isFinite(limit) || limit < 0) {
        throw new Error(`Invalid LIMIT clause: ${clause}`);
      }
      query.limit = limit;
      continue;
    }
  }

  if (query.type === "table" && query.columns.length === 0) {
    query.columns = [
      { expression: "file.link", label: "Page" },
    ];
  }

  return query;
}

function getFieldValue(page: DataviewPage, expression: string): unknown {
  const normalized = expression.trim();

  switch (normalized) {
    case "file.name":
      return page.name;
    case "file.path":
      return page.path;
    case "file.folder":
      return page.folder;
    case "file.link":
      return page.title;
    case "title":
      return page.title;
    case "tags":
    case "file.tags":
      return page.tags;
    case "created":
      return page.created;
    case "modified":
      return page.modified;
    case "icon":
      return page.icon;
    case "order":
      return page.order;
    case "body":
      return page.body;
    default:
      return page.frontmatter[normalized];
  }
}

function isDateLike(value: unknown): boolean {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function compareValues(left: unknown, right: unknown): number {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  if (isDateLike(left) && isDateLike(right)) {
    return Date.parse(String(left)) - Date.parse(String(right));
  }

  return String(left ?? "").localeCompare(String(right ?? ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function matchesFilter(page: DataviewPage, filter: DataviewFilter): boolean {
  const left = getFieldValue(page, filter.field);
  const right = filter.value;
  const normalizedRight = String(right ?? "").toLowerCase();

  if (filter.type === "contains") {
    if (Array.isArray(left)) {
      return left.some((value) =>
        String(value).toLowerCase() === normalizedRight
      );
    }

    return String(left ?? "").toLowerCase().includes(normalizedRight);
  }

  const comparison = compareValues(left, right);

  switch (filter.operator) {
    case "=":
      if (Array.isArray(left)) {
        return left.some((value) => compareValues(value, right) === 0);
      }
      return comparison === 0;
    case "!=":
      if (Array.isArray(left)) {
        return left.every((value) => compareValues(value, right) !== 0);
      }
      return comparison !== 0;
    case ">":
      return comparison > 0;
    case ">=":
      return comparison >= 0;
    case "<":
      return comparison < 0;
    case "<=":
      return comparison <= 0;
    default:
      return false;
  }
}

function formatCellValue(page: DataviewPage, expression: string): string {
  const value = getFieldValue(page, expression);

  if (expression.trim() === "file.link") {
    const label = escapeHtml(page.title || page.name);
    return `<a data-wiki-link="true" data-page-name="${escapeHtml(page.title)}" data-page-path="${escapeHtml(page.path)}" class="wiki-link">${label}</a>`;
  }

  if (Array.isArray(value)) {
    return escapeHtml(value.map((entry) => String(entry)).join(", "));
  }

  if (value === null || value === undefined || value === "") {
    return "—";
  }

  return escapeHtml(String(value));
}

function renderErrorBlock(message: string, source: string): string {
  return [
    `<div data-dataview="true" data-dataview-source="${encodeDataviewAttribute(source)}" class="dataview-block">`,
    `<div class="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">`,
    `<strong>Dataview error:</strong> ${escapeHtml(message)}`,
    `</div>`,
    `</div>`,
  ].join("");
}

function renderTable(query: DataviewQuery, pages: DataviewPage[], source: string): string {
  const headers = query.columns
    .map((column) => `<th>${escapeHtml(column.label)}</th>`)
    .join("");

  const rows = pages
    .map(
      (page) =>
        `<tr>${query.columns
          .map((column) => `<td>${formatCellValue(page, column.expression)}</td>`)
          .join("")}</tr>`
    )
    .join("");

  return [
    `<div data-dataview="true" data-dataview-source="${encodeDataviewAttribute(source)}" class="dataview-block">`,
    `<div class="my-4 overflow-x-auto rounded-lg border border-border bg-muted/10 p-3" contenteditable="false">`,
    `<table class="border-collapse w-full text-sm">`,
    `<thead><tr>${headers}</tr></thead>`,
    `<tbody>${rows || `<tr><td colspan="${Math.max(query.columns.length, 1)}">No results.</td></tr>`}</tbody>`,
    `</table>`,
    `</div>`,
    `</div>`,
  ].join("");
}

function renderList(query: DataviewQuery, pages: DataviewPage[], source: string): string {
  const expression = query.listExpression || "file.link";
  const items = pages
    .map((page) => `<li>${formatCellValue(page, expression)}</li>`)
    .join("");

  return [
    `<div data-dataview="true" data-dataview-source="${encodeDataviewAttribute(source)}" class="dataview-block">`,
    `<div class="my-4 rounded-lg border border-border bg-muted/10 px-4 py-3" contenteditable="false">`,
    items ? `<ul>${items}</ul>` : `<p class="m-0 text-sm text-muted-foreground">No results.</p>`,
    `</div>`,
    `</div>`,
  ].join("");
}

async function collectDataviewPagesFromRoot(
  rootPath: string,
  results: Map<string, DataviewPage>
): Promise<void> {
  const entries = await listDirectory(rootPath);

  for (const entry of entries) {
    if (isHiddenEntry(entry.name)) continue;

    const fullPath = path.join(rootPath, entry.name);

    if (entry.isDirectory) {
      const indexMd = path.join(fullPath, "index.md");
      if (await fileExists(indexMd)) {
        const raw = await readFileContent(indexMd);
        const { data, content } = parseFrontmatterSafely(raw);
        const virtualPath = normalizeVirtualPath(virtualPathFromFs(fullPath));
        results.set(virtualPath, {
          path: virtualPath,
          folder: virtualPath,
          name: path.posix.basename(virtualPath) || "index",
          title: String(data.title || path.basename(fullPath)),
          tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
          created: typeof data.created === "string" ? data.created : undefined,
          modified: typeof data.modified === "string" ? data.modified : undefined,
          icon: typeof data.icon === "string" ? data.icon : undefined,
          order: typeof data.order === "number" ? data.order : undefined,
          body: content.trim(),
          frontmatter: data,
        });
      }

      await collectDataviewPagesFromRoot(fullPath, results);
      continue;
    }

    if (!entry.name.toLowerCase().endsWith(".md") || entry.name === "index.md") {
      continue;
    }

    const raw = await readFileContent(fullPath);
    const { data, content } = parseFrontmatterSafely(raw);
    const virtualPath = normalizeVirtualPath(virtualPathFromFs(fullPath));
    const folder = normalizeVirtualPath(path.posix.dirname(virtualPath));
    results.set(virtualPath, {
      path: virtualPath,
      folder: folder === "." ? "" : folder,
      name: path.posix.basename(virtualPath, ".md"),
      title: String(data.title || path.basename(fullPath, ".md")),
      tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
      created: typeof data.created === "string" ? data.created : undefined,
      modified: typeof data.modified === "string" ? data.modified : undefined,
      icon: typeof data.icon === "string" ? data.icon : undefined,
      order: typeof data.order === "number" ? data.order : undefined,
      body: content.trim(),
      frontmatter: data,
    });
  }
}

async function collectDataviewPages(): Promise<DataviewPage[]> {
  const { vaultRoot, runtimeRoot } = getYantraRoots();
  const roots = Array.from(new Set([vaultRoot, runtimeRoot]));
  const results = new Map<string, DataviewPage>();

  for (const root of roots) {
    await collectDataviewPagesFromRoot(root, results);
  }

  return Array.from(results.values());
}

function applyQuery(pages: DataviewPage[], query: DataviewQuery): DataviewPage[] {
  let results = [...pages];

  if (query.sourceTag) {
    results = results.filter((page) =>
      page.tags.some((tag) => tag.toLowerCase() === query.sourceTag)
    );
  }

  if (query.source !== undefined) {
    const sourcePath = normalizeVirtualPath(query.source);
    if (sourcePath) {
      results = results.filter(
        (page) => page.path === sourcePath || page.path.startsWith(`${sourcePath}/`)
      );
    }
  }

  if (query.filters.length > 0) {
    results = results.filter((page) =>
      query.filters.every((filter) => matchesFilter(page, filter))
    );
  }

  if (query.sort) {
    results.sort((left, right) => {
      const comparison = compareValues(
        getFieldValue(left, query.sort!.field),
        getFieldValue(right, query.sort!.field)
      );
      return query.sort!.direction === "desc" ? -comparison : comparison;
    });
  } else {
    results.sort((left, right) => left.path.localeCompare(right.path));
  }

  if (typeof query.limit === "number") {
    results = results.slice(0, query.limit);
  }

  return results;
}

async function renderSingleDataviewBlock(
  source: string,
  pages: DataviewPage[],
  pagePath?: string
): Promise<string> {
  try {
    const query = parseDataviewQuery(source, pagePath);
    const results = applyQuery(pages, query);
    return query.type === "table"
      ? renderTable(query, results, source)
      : renderList(query, results, source);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown dataview error";
    return renderErrorBlock(message, source);
  }
}

export async function renderDataviewBlocks(markdown: string, pagePath?: string): Promise<string> {
  const blockPattern = /```dataview\s*\n([\s\S]*?)```/gi;
  const matches = Array.from(markdown.matchAll(blockPattern));
  if (matches.length === 0) {
    return markdown;
  }

  let output = "";
  let lastIndex = 0;
  const pages = await collectDataviewPages();

  for (const match of matches) {
    const fullMatch = match[0];
    const source = match[1] || "";
    const matchIndex = match.index ?? 0;
    output += markdown.slice(lastIndex, matchIndex);
    output += await renderSingleDataviewBlock(source.trim(), pages, pagePath);
    lastIndex = matchIndex + fullMatch.length;
  }

  output += markdown.slice(lastIndex);
  return output;
}
