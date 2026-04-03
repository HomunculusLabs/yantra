export interface FrontMatter {
  title: string;
  created: string;
  modified: string;
  tags: string[];
  icon?: string;
  order?: number;
  dir?: "ltr" | "rtl";
}

export interface TreeNode {
  name: string;
  path: string;
  type: "file" | "text" | "directory" | "website" | "app" | "pdf" | "csv";
  hasRepo?: boolean;
  frontmatter?: Partial<FrontMatter>;
  children?: TreeNode[];
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
