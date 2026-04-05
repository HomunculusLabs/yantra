#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const target = process.argv[2];

const buildTargets = {
  daemon: [
    {
      entry: "./server/yantra-daemon.ts",
      outfile: "dist/daemon/yantra-daemon.js",
      format: "esm",
    },
  ],
  electron: [
    {
      entry: "./electron/main.ts",
      outfile: "dist/electron/main.js",
      format: "cjs",
    },
    {
      entry: "./electron/preload.ts",
      outfile: "dist/electron/preload.js",
      format: "cjs",
    },
  ],
};

if (!target || !(target in buildTargets)) {
  console.error("Usage: node scripts/build-runtime-bundles.mjs <daemon|electron>");
  process.exit(1);
}

const packageJsonPath = path.join(root, "package.json");
const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
const dependencyPackages = Object.keys(pkg.dependencies || {});
const externalPackages =
  target === "electron"
    ? [...dependencyPackages, "electron"]
    : dependencyPackages;

for (const build of buildTargets[target]) {
  const args = [
    "build",
    build.entry,
    "--outfile",
    build.outfile,
    "--target",
    "node",
    "--format",
    build.format,
    "--packages",
    "bundle",
  ];

  for (const packageName of externalPackages) {
    args.push("--external", packageName);
  }

  const result = spawnSync("bun", args, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
