#!/usr/bin/env node
import fs from "fs";
import path from "path";

const root = process.cwd();
const distDir = path.join(root, "dist");
const runtimeDir = path.join(distDir, "app-runtime");
const standaloneRoot = fs.existsSync(path.join(root, ".next", "standalone", "yantra", "server.js"))
  ? path.join(root, ".next", "standalone", "yantra")
  : path.join(root, ".next", "standalone");

function resetDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  fs.mkdirSync(dirPath, { recursive: true });
}

function copy(source, destination) {
  if (!fs.existsSync(source)) {
    throw new Error(`Missing required input: ${source}`);
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true });
}

resetDir(runtimeDir);

copy(standaloneRoot, path.join(runtimeDir, "web"));
copy(path.join(root, ".next", "static"), path.join(runtimeDir, "web", ".next", "static"));
copy(path.join(root, "public"), path.join(runtimeDir, "web", "public"));
copy(path.join(root, "dist", "daemon", "yantra-daemon.js"), path.join(runtimeDir, "daemon", "yantra-daemon.js"));
copy(path.join(root, "server", "migrations"), path.join(runtimeDir, "server", "migrations"));
copy(path.join(root, "data"), path.join(runtimeDir, "seed-data"));
copy(path.join(root, ".env.example"), path.join(runtimeDir, ".env.example"));
copy(path.join(root, "node_modules"), path.join(runtimeDir, "node_modules"));

console.log(`Staged desktop runtime at ${runtimeDir}`);
