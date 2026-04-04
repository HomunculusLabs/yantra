#!/usr/bin/env node
import fs from "fs";
import path from "path";

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const failures = [];
const approvedTrustedDependencies = ["better-sqlite3", "electron", "node-pty"];

function fail(message) {
  failures.push(message);
}

function isExact(version) {
  return typeof version === "string" && /^\d+\.\d+\.\d+(?:[-+].+)?$/.test(version);
}

if (!/^bun@\d+\.\d+\.\d+$/.test(pkg.packageManager || "")) {
  fail("packageManager must pin Bun exactly.");
}

if (!fs.existsSync(path.join(root, "bun.lock"))) {
  fail("bun.lock is required.");
}

if (fs.existsSync(path.join(root, "package-lock.json"))) {
  fail("package-lock.json must be removed.");
}

for (const section of ["dependencies", "devDependencies"]) {
  for (const [name, version] of Object.entries(pkg[section] || {})) {
    if (!isExact(version)) {
      fail(`${section}.${name} must use an exact version, found ${version}.`);
    }
  }
}

for (const [name, script] of Object.entries(pkg.scripts || {})) {
  if (/\b(?:npm|npx|pnpm|yarn)\b/.test(String(script))) {
    fail(`script "${name}" contains a non-Bun package runner: ${script}`);
  }
}

if ("postinstall" in (pkg.scripts || {})) {
  fail("root postinstall must not exist.");
}

const trustedDependencies = [...(pkg.trustedDependencies || [])].sort();
if (JSON.stringify(trustedDependencies) !== JSON.stringify(approvedTrustedDependencies)) {
  fail(`trustedDependencies must equal ${approvedTrustedDependencies.join(", ")}.`);
}

for (const relativeFile of ["cli/index.js", "Dockerfile", "scripts/stage-desktop.mjs"]) {
  const fullPath = path.join(root, relativeFile);
  if (!fs.existsSync(fullPath)) continue;
  const content = fs.readFileSync(fullPath, "utf8");
  if (/\b(?:npm|npx|pnpm|yarn)\b/.test(content)) {
    fail(`${relativeFile} still references a non-Bun package runner.`);
  }
}

if (failures.length > 0) {
  console.error("Supply-chain verification failed:");
  for (const message of failures) {
    console.error(` - ${message}`);
  }
  process.exit(1);
}

console.log("Supply-chain policy verified.");
