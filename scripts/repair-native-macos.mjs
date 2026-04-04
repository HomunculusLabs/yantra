#!/usr/bin/env node
import fs from "fs";
import { execFileSync } from "child_process";
import path from "path";

if (process.platform !== "darwin") {
  console.log("Native repair is only needed on macOS.");
  process.exit(0);
}

const root = process.cwd();
const targets = [
  "node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper",
  "node_modules/node-pty/prebuilds/darwin-arm64/pty.node",
].map((relativePath) => path.join(root, relativePath));

for (const target of targets) {
  if (!fs.existsSync(target)) continue;

  try {
    fs.chmodSync(target, 0o755);
  } catch {
    // ignore chmod failures
  }

  try {
    execFileSync("xattr", ["-d", "com.apple.provenance", target], {
      stdio: "ignore",
    });
  } catch {
    // ignore when the attribute is already absent
  }
}

console.log("macOS native binary repair completed.");
