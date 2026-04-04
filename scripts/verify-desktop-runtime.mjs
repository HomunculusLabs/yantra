#!/usr/bin/env node
import fs from "fs";
import path from "path";

const root = process.cwd();
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

console.log("Desktop runtime verified.");
