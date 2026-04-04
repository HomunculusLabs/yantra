#!/usr/bin/env node

const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const REPO = "https://github.com/HomunculusLabs/yantra.git";
const DIR = "yantra";

const args = process.argv.slice(2);
const COMMANDS = ["init", "help", "--help"];
const firstArg = args[0] || "init";
const command = COMMANDS.includes(firstArg) ? firstArg : "init";
const dirArg = COMMANDS.includes(firstArg) ? args[1] : firstArg;

const log = (msg) => console.log(`\x1b[36m>\x1b[0m ${msg}`);
const success = (msg) => console.log(`\x1b[32m✓\x1b[0m ${msg}`);
const error = (msg) => {
  console.error(`\x1b[31m✗\x1b[0m ${msg}`);
  process.exit(1);
};

function run(bin, args, opts = {}) {
  const result = spawnSync(bin, args, {
    stdio: "inherit",
    ...opts,
  });
  if (result.status !== 0) {
    error(`Command failed: ${bin} ${args.join(" ")}`);
  }
}

function bunCommand() {
  return process.platform === "win32" ? "bun.exe" : "bun";
}

function hasBun() {
  const result = spawnSync(bunCommand(), ["--version"], { stdio: "ignore" });
  return result.status === 0;
}

function validateTargetDir(targetDir) {
  if (!targetDir || !targetDir.trim()) {
    error("Please provide a valid directory name.");
  }
  if (targetDir.startsWith("-")) {
    error("Directory names cannot start with '-'.");
  }
}

if (command === "init") {
  const targetDir = dirArg || DIR;
  validateTargetDir(targetDir);

  console.log(`
  ┌─────────────────────────────┐
  │                             │
  │   📦  Yantra               │
  │   AI-first startup OS       │
  │                             │
  └─────────────────────────────┘
  `);

  if (fs.existsSync(targetDir)) {
    error(`Directory "${targetDir}" already exists.`);
  }

  log(`Cloning Yantra into ./${targetDir}...`);
  run("git", ["clone", "--depth", "1", REPO, targetDir]);

  if (!hasBun()) {
    error("Bun is required. Install Bun from https://bun.sh before continuing.");
  }

  log("Installing dependencies...");
  run(bunCommand(), ["install", "--frozen-lockfile"], { cwd: targetDir });

  const envExample = path.join(targetDir, ".env.example");
  const envLocal = path.join(targetDir, ".env.local");
  if (fs.existsSync(envExample) && !fs.existsSync(envLocal)) {
    fs.copyFileSync(envExample, envLocal);
  }

  fs.rmSync(path.join(targetDir, ".git"), { recursive: true, force: true });
  run("git", ["init"], { cwd: targetDir });

  console.log("");
  success("Yantra is ready!");
  console.log(`
  Next steps:

    cd ${targetDir}
    bun run dev

  Yantra will open as a desktop app.

  The onboarding wizard will guide you through
  setting up your AI team.
  `);
} else if (command === "help" || command === "--help") {
  console.log(`
  create-yantra - Create a new Yantra project

  Usage:
    bunx create-yantra [directory]         Create a new project
    bunx create-yantra help                Show this help

  Notes:
    Bun is required for installation and development.
  `);
} else {
  error(`Unknown command: ${command}. Run \"create-yantra help\" for usage.`);
}
