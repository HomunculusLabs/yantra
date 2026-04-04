import fs from "fs";
import path from "path";
import type { DesktopRuntimeSpec } from "./runtime";

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function isEmptyDirectory(dirPath: string): boolean {
  if (!fs.existsSync(dirPath)) return true;
  return fs.readdirSync(dirPath).length === 0;
}

function copyRecursive(
  source: string,
  destination: string,
  filter?: (relativePath: string) => boolean
): void {
  const visit = (src: string, dest: string, relativePath: string) => {
    if (filter && !filter(relativePath)) {
      return;
    }

    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
      ensureDir(dest);
      for (const entry of fs.readdirSync(src)) {
        const nextRelative = relativePath ? path.join(relativePath, entry) : entry;
        visit(path.join(src, entry), path.join(dest, entry), nextRelative);
      }
      return;
    }

    ensureDir(path.dirname(dest));
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(src, dest);
    }
  };

  visit(source, destination, "");
}

export function seedDesktopState(spec: DesktopRuntimeSpec): void {
  ensureDir(spec.configRoot);

  if (spec.envExamplePath && fs.existsSync(spec.envExamplePath)) {
    const envLocalPath = path.join(spec.configRoot, ".env.local");
    if (!fs.existsSync(envLocalPath)) {
      fs.copyFileSync(spec.envExamplePath, envLocalPath);
    }
  }

  if (!spec.seedDataDir || !fs.existsSync(spec.seedDataDir)) {
    return;
  }

  if (isEmptyDirectory(spec.defaultVaultRoot)) {
    copyRecursive(spec.seedDataDir, spec.defaultVaultRoot, (relativePath) => {
      if (!relativePath) return true;
      return !relativePath.startsWith(".agents") && !relativePath.startsWith(".jobs");
    });
  } else {
    ensureDir(spec.defaultVaultRoot);
  }

  if (isEmptyDirectory(spec.defaultRuntimeRoot)) {
    copyRecursive(spec.seedDataDir, spec.defaultRuntimeRoot, (relativePath) => {
      if (!relativePath) return true;
      if (relativePath === ".agents" || relativePath.startsWith(".agents/")) {
        return true;
      }
      if (relativePath === ".jobs" || relativePath.startsWith(".jobs/")) {
        return !relativePath.startsWith(".jobs/.history");
      }
      return false;
    });
  } else {
    ensureDir(spec.defaultRuntimeRoot);
  }
}
