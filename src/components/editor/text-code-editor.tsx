"use client";

import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import type { Extension } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { yaml } from "@codemirror/lang-yaml";
import { python } from "@codemirror/lang-python";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { markdown } from "@codemirror/lang-markdown";
import { xml } from "@codemirror/lang-xml";
import { sql } from "@codemirror/lang-sql";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { toml } from "@codemirror/legacy-modes/mode/toml";

export interface TextEditorLanguage {
  label: string;
  extension: Extension | null;
}

interface TextCodeEditorProps {
  path: string;
  value: string;
  onChange: (value: string) => void;
  language?: TextEditorLanguage;
}

const shellLanguage = StreamLanguage.define(shell);
const propertiesLanguage = StreamLanguage.define(properties);
const tomlLanguage = StreamLanguage.define(toml);

const plainTextLanguage: TextEditorLanguage = { label: "Plain text", extension: null };
const yamlLanguage: TextEditorLanguage = { label: "YAML", extension: yaml() };
const jsonLanguage: TextEditorLanguage = { label: "JSON", extension: json() };
const pythonLanguage: TextEditorLanguage = { label: "Python", extension: python() };
const typeScriptReactLanguage: TextEditorLanguage = {
  label: "TypeScript React",
  extension: javascript({ typescript: true, jsx: true }),
};
const typeScriptLanguage: TextEditorLanguage = {
  label: "TypeScript",
  extension: javascript({ typescript: true }),
};
const javaScriptReactLanguage: TextEditorLanguage = {
  label: "JavaScript React",
  extension: javascript({ jsx: true }),
};
const javaScriptLanguage: TextEditorLanguage = {
  label: "JavaScript",
  extension: javascript(),
};
const cssLanguage: TextEditorLanguage = { label: "CSS", extension: css() };
const scssLanguage: TextEditorLanguage = { label: "SCSS", extension: css() };
const htmlLanguage: TextEditorLanguage = { label: "HTML", extension: html() };
const xmlLanguage: TextEditorLanguage = { label: "XML", extension: xml() };
const sqlLanguage: TextEditorLanguage = { label: "SQL", extension: sql() };
const markdownLanguage: TextEditorLanguage = {
  label: "Markdown",
  extension: markdown(),
};
const mdxLanguage: TextEditorLanguage = {
  label: "MDX",
  extension: markdown(),
};
const tomlEditorLanguage: TextEditorLanguage = {
  label: "TOML",
  extension: tomlLanguage,
};
const iniLanguage: TextEditorLanguage = {
  label: "INI",
  extension: propertiesLanguage,
};
const envLanguage: TextEditorLanguage = {
  label: "Env",
  extension: propertiesLanguage,
};
const shellEditorLanguage: TextEditorLanguage = {
  label: "Shell",
  extension: shellLanguage,
};

const codeMirrorBasicSetup = {
  lineNumbers: true,
  foldGutter: true,
  highlightActiveLine: true,
  highlightActiveLineGutter: true,
  bracketMatching: true,
  closeBrackets: true,
  autocompletion: true,
  syntaxHighlighting: true,
};

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "transparent",
    fontSize: "13px",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "var(--font-mono), ui-monospace, monospace",
    lineHeight: "1.7",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    border: "none",
    color: "var(--muted-foreground)",
    paddingRight: "0.75rem",
  },
  ".cm-content": {
    minHeight: "calc(100vh - 12rem)",
    padding: "1rem 1rem 1rem 0",
    caretColor: "var(--foreground)",
  },
  ".cm-line": {
    paddingLeft: "0.25rem",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--foreground)",
  },
  ".cm-activeLine": {
    backgroundColor: "var(--muted)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
    color: "var(--foreground)",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--accent)",
  },
  ".cm-focused": {
    outline: "none",
  },
});

function getPathBasedLanguage(path: string): TextEditorLanguage | null {
  const lowerPath = path.toLowerCase();
  const fileName = lowerPath.split("/").pop() ?? lowerPath;

  if (lowerPath.endsWith(".yaml") || lowerPath.endsWith(".yml")) return yamlLanguage;
  if (lowerPath.endsWith(".json")) return jsonLanguage;
  if (lowerPath.endsWith(".py")) return pythonLanguage;
  if (lowerPath.endsWith(".tsx")) return typeScriptReactLanguage;
  if (lowerPath.endsWith(".ts")) return typeScriptLanguage;
  if (lowerPath.endsWith(".jsx")) return javaScriptReactLanguage;
  if (
    lowerPath.endsWith(".js") ||
    lowerPath.endsWith(".mjs") ||
    lowerPath.endsWith(".cjs")
  ) return javaScriptLanguage;
  if (lowerPath.endsWith(".css")) return cssLanguage;
  if (lowerPath.endsWith(".scss")) return scssLanguage;
  if (lowerPath.endsWith(".html")) return htmlLanguage;
  if (lowerPath.endsWith(".xml")) return xmlLanguage;
  if (lowerPath.endsWith(".sql")) return sqlLanguage;
  if (lowerPath.endsWith(".md")) return markdownLanguage;
  if (lowerPath.endsWith(".mdx")) return mdxLanguage;
  if (lowerPath.endsWith(".toml")) return tomlEditorLanguage;
  if (lowerPath.endsWith(".ini")) return iniLanguage;
  if (fileName === ".env" || fileName.startsWith(".env.")) return envLanguage;
  if (
    lowerPath.endsWith(".sh") ||
    lowerPath.endsWith(".bash") ||
    lowerPath.endsWith(".zsh") ||
    [
      ".bashrc",
      ".bash_profile",
      ".zshrc",
      ".zprofile",
      ".zshenv",
      ".profile",
    ].includes(fileName)
  ) return shellEditorLanguage;

  return null;
}

function detectShebangLanguage(value: string): TextEditorLanguage | null {
  const firstLine = value.split(/\r?\n/, 1)[0]?.trim() ?? "";

  if (/^#!.*\bpython(?:3)?\b/.test(firstLine)) {
    return pythonLanguage;
  }

  if (
    /^#!.*\b(?:ba|z|k|fi)?sh\b/.test(firstLine) ||
    /^#!.*\bbusybox\b/.test(firstLine)
  ) {
    return shellEditorLanguage;
  }

  return null;
}

export function getTextEditorLanguage(path: string, value = ""): TextEditorLanguage {
  return getPathBasedLanguage(path) ?? detectShebangLanguage(value) ?? plainTextLanguage;
}

export function TextCodeEditor({ path, value, onChange, language }: TextCodeEditorProps) {
  const resolvedLanguage = language ?? getTextEditorLanguage(path, value);
  const extensions = useMemo(
    () => [editorTheme, ...(resolvedLanguage.extension ? [resolvedLanguage.extension] : [])],
    [resolvedLanguage.extension]
  );

  return (
    <CodeMirror
      value={value}
      height="100%"
      basicSetup={codeMirrorBasicSetup}
      extensions={extensions}
      onChange={onChange}
      theme="none"
      className="h-full"
    />
  );
}
