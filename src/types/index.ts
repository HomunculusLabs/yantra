export interface FrontMatter {
  title: string;
  created: string;
  modified: string;
  tags: string[];
  icon?: string;
  order?: number;
  dir?: "ltr" | "rtl";
}

export type TreeNodeType =
  | "file"
  | "text"
  | "directory"
  | "website"
  | "app"
  | "pdf"
  | "csv";

export interface TreeNode {
  name: string;
  path: string;
  type: TreeNodeType;
  canOpen: boolean;
  hasRepo?: boolean;
  frontmatter?: Partial<FrontMatter>;
  children?: TreeNode[];
}

export interface VisibleTreeRow {
  path: string;
  parentPath: string | null;
  depth: number;
  type: TreeNodeType;
  title: string;
  canOpen: boolean;
  hasChildren: boolean;
  isExpanded: boolean;
  hasRepo?: boolean;
}

export interface PageData {
  path: string;
  requestedPath?: string;
  backingPath?: string;
  kind?: "markdown" | "directory-index" | "text" | "pdf" | "csv";
  editable?: boolean;
  content: string;
  frontmatter: FrontMatter;
}

export type SaveStatus = "idle" | "saving" | "saved" | "error";
export type PageLoadState = "idle" | "loading" | "preparing" | "ready" | "error";
