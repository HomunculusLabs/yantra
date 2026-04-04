#!/usr/bin/env node
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const tsxBin = path.join(
  projectRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tsx.cmd" : "tsx"
);

const env = {
  ...process.env,
  PWD: projectRoot,
  INIT_CWD: projectRoot,
  npm_config_local_prefix: projectRoot,
};

process.chdir(projectRoot);
console.log(`[yantra:daemon-bootstrap] cwd=${process.cwd()}`);
console.log(`[yantra:daemon-bootstrap] tsx=${tsxBin}`);

const child = spawn(tsxBin, ["server/yantra-daemon.ts"], {
  cwd: projectRoot,
  env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
