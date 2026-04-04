#!/usr/bin/env node
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const nextBin = path.join(
  projectRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "next.cmd" : "next"
);

const exactEnvKeys = new Set([
  "PATH",
  "HOME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "TERM_PROGRAM",
  "TERM_PROGRAM_VERSION",
  "COLORTERM",
  "TMPDIR",
  "TMP",
  "TEMP",
  "USER",
  "LOGNAME",
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "XAUTHORITY",
  "XDG_RUNTIME_DIR",
  "SSH_AUTH_SOCK",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "NODE_OPTIONS",
  "FORCE_COLOR",
  "NO_COLOR",
  "CI",
  "http_proxy",
  "https_proxy",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "all_proxy",
  "NO_PROXY",
  "no_proxy",
  "__CFBundleIdentifier",
  "__CF_USER_TEXT_ENCODING",
  "XPC_FLAGS",
  "XPC_SERVICE_NAME",
  "COMMAND_MODE",
  "SECURITYSESSIONID",
  "Apple_PubSub_Socket_Render",
]);

const allowedPrefixes = ["YANTRA_", "NEXT_"];
const blockedPrefixes = [
  "npm_",
  "npm_package_",
  "BUN_",
  "PNPM_",
  "YARN_",
  "TURBO_",
];

function buildWebEnv(sourceEnv) {
  const env = {};

  for (const [key, value] of Object.entries(sourceEnv)) {
    if (typeof value !== "string" || value.length === 0) {
      continue;
    }

    if (blockedPrefixes.some((prefix) => key.startsWith(prefix))) {
      continue;
    }

    if (
      exactEnvKeys.has(key) ||
      allowedPrefixes.some((prefix) => key.startsWith(prefix))
    ) {
      env[key] = value;
    }
  }

  env.PWD = projectRoot;
  env.INIT_CWD = projectRoot;
  env.npm_config_local_prefix = projectRoot;
  env.npm_package_json = path.join(projectRoot, "package.json");
  env.NODE_ENV = env.NODE_ENV || "development";
  env.NEXT_TELEMETRY_DISABLED = "1";
  env.PORT = env.PORT || "3000";
  env.HOSTNAME = env.HOSTNAME || "127.0.0.1";

  return env;
}

const env = buildWebEnv(process.env);

process.chdir(projectRoot);
console.log(`[yantra:web-bootstrap] cwd=${process.cwd()}`);
console.log(`[yantra:web-bootstrap] next=${nextBin}`);
console.log(
  `[yantra:web-bootstrap] npm_package_json=${env.npm_package_json}`
);

const child = spawn(
  nextBin,
  ["dev", "--webpack", "--hostname", env.HOSTNAME, "--port", env.PORT],
  {
    cwd: projectRoot,
    env,
    stdio: "inherit",
  }
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
