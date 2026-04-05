#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const runtimeDir = path.join(root, "dist", "app-runtime");
const required = [
  "web/server.js",
  "web/.next/static",
  "daemon/yantra-daemon.js",
  "server/migrations",
  "seed-data",
  ".env.example",
  "node_modules",
];

const missing = required.filter((relativePath) => {
  return !fs.existsSync(path.join(runtimeDir, relativePath));
});

if (missing.length > 0) {
  console.error("Desktop runtime verification failed. Missing:");
  for (const relativePath of missing) {
    console.error(` - ${relativePath}`);
  }
  process.exit(1);
}

const aliasChecks = [
  path.join(root, "dist", "electron", "main.js"),
  path.join(root, "dist", "electron", "preload.js"),
  path.join(runtimeDir, "daemon", "yantra-daemon.js"),
];
const unresolvedAliases = aliasChecks.filter((filePath) => {
  if (!fs.existsSync(filePath)) return false;
  const content = fs.readFileSync(filePath, "utf-8");
  return /(?:from\s+|require\()\s*["']@\//.test(content);
});

if (unresolvedAliases.length > 0) {
  console.error("Desktop runtime verification failed. Unresolved @/ module specifiers found:");
  for (const filePath of unresolvedAliases) {
    console.error(` - ${path.relative(root, filePath)}`);
  }
  process.exit(1);
}

console.log("Desktop runtime verified.");
