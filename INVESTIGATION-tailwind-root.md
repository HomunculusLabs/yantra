# Investigation: Next dev resolves Tailwind against parent workspace root

## Summary
The failure was not caused by Electron using the wrong cwd. The real issue is that **Next 16 dev mode with Turbopack is selecting `/Users/t3rpz/projects` as the workspace root** because that parent directory has its own `package.json` and lockfiles, including `/Users/t3rpz/projects/bun.lock`. When `/` compiles, CSS package imports from `src/app/globals.css` are resolved relative to that parent workspace root and fail. The verified fix is to **run Next dev with webpack instead of Turbopack** in `scripts/run-web-dev.mjs`.

## Symptoms
- `Can't resolve 'tailwindcss' in '/Users/t3rpz/projects'`
- Resolver details explicitly use `/Users/t3rpz/projects/package.json`
- Server starts successfully, but the failure appears when `/` compiles
- The same failure occurs under both Electron-launched dev and plain `node scripts/run-web-dev.mjs`

## Investigation Log

### Initial hypothesis - Electron uses the wrong repo root
**Hypothesis:** Electron was computing the wrong project root or spawning `next dev` from the wrong cwd.

**Findings:** Eliminated.

**Evidence:**
- `electron/runtime.ts:61-67` resolves `projectRoot` for dev mode.
- `electron/runtime.ts:71-101` sets `web.cwd = projectRoot`.
- `electron/main.ts:68-74` spawns children with `cwd: spec.cwd`.
- `electron/main.ts:205-209` logs:
  - `cwd=/Users/t3rpz/projects/yantra`
  - `web cwd=/Users/t3rpz/projects/yantra`
- Process inspection showed the live Next process had cwd `.../yantra`.

**Conclusion:** Electron cwd was correct.

### Follow-up hypothesis - the web bootstrap computes the wrong root
**Hypothesis:** `scripts/run-web-dev.mjs` was resolving the wrong repo root.

**Findings:** Eliminated.

**Evidence:**
- `scripts/run-web-dev.mjs:6-12` computes `projectRoot = path.resolve(scriptDir, "..")`.
- `scripts/run-web-dev.mjs:95-102` pins:
  - `PWD`
  - `INIT_CWD`
  - `npm_config_local_prefix`
  - `npm_package_json`
- Bootstrap logs showed:
  - `cwd=/Users/t3rpz/projects/yantra`
  - `npm_package_json=/Users/t3rpz/projects/yantra/package.json`

**Conclusion:** The wrapper root was correct.

### Reproduction refinement - failure occurs on page compile, not on server start
**Hypothesis:** The issue was specific to Electron.

**Findings:** Eliminated.

**Evidence:**
1. `node scripts/run-web-dev.mjs` started cleanly.
2. Requesting `/` with `curl -I http://127.0.0.1:3000/` triggered the same Tailwind resolution failure.
3. `bun run dev` under Electron reproduced the same failure at `GET /`, not at boot.

**Conclusion:** This is a Next dev compilation issue, not an Electron-only issue.

### Root cause verification - Turbopack workspace root selection
**Hypothesis:** Turbopack was choosing the parent workspace root because the parent directory contains lockfiles and a package boundary.

**Findings:** Confirmed.

**Evidence:**
- `/Users/t3rpz/projects/package.json` exists.
- `/Users/t3rpz/projects/bun.lock` exists.
- `/Users/t3rpz/projects/package-lock.json` exists.
- `node_modules/next/dist/lib/find-root.js:91-107` walks upward through lockfiles and picks the highest matching root.
- `node_modules/next/dist/docs/01-app/03-api-reference/08-turbopack.md:146-150` states Turbopack uses a filesystem root for module resolution.
- `src/app/globals.css:1-4` imports CSS packages:
  - `tailwindcss`
  - `tw-animate-css`
  - `shadcn/tailwind.css`
- The actual resolver error used `/Users/t3rpz/projects/package.json` as the description file root.

**Conclusion:** Turbopack dev root selection is the real cause.

### Verified fix - use webpack for dev
**Hypothesis:** Forcing webpack for `next dev` will bypass the Turbopack workspace-root bug and allow the app to compile normally.

**Findings:** Confirmed.

**Evidence:**
- `scripts/run-web-dev.mjs:112-119` now launches:
  - `next dev --webpack --hostname ... --port ...`
- Plain dev verification:
  - `node scripts/run-web-dev.mjs` started as `Next.js 16.2.1 (webpack)`
  - `curl -I http://127.0.0.1:3000/` returned `HTTP/1.1 200 OK`
- Electron verification:
  - `bun run dev` started as `Next.js 16.2.1 (webpack)`
  - `GET / 200`
  - renderer loaded successfully at `http://127.0.0.1:3000`

**Conclusion:** Switching dev mode to webpack fixes the issue.

## Root Cause
The root cause is **Turbopack dev-mode workspace-root selection** in a nested project layout.

Yantra lives at:
- `/Users/t3rpz/projects/yantra`

But the parent directory also has:
- `/Users/t3rpz/projects/package.json`
- `/Users/t3rpz/projects/bun.lock`
- `/Users/t3rpz/projects/package-lock.json`

Next’s root-finding logic walks upward through lockfiles and can treat the parent directory as the workspace root. Once `/` compiles, CSS package imports in `src/app/globals.css` are resolved against `/Users/t3rpz/projects`, which does not contain the required packages, so Tailwind resolution fails.

## Eliminated Hypotheses
1. Bad `..` path in Electron root inference
2. Wrong child process cwd
3. Wrong root in `scripts/run-web-dev.mjs`
4. Electron-specific failure mode
5. CSS package import syntax itself as the primary cause

## Recommendations
1. **Keep webpack for dev launches**
   - File: `scripts/run-web-dev.mjs`
   - This is the verified fix.

2. **Keep the env sanitization in the web bootstrap**
   - File: `scripts/run-web-dev.mjs`
   - It is still useful hardening and reduces accidental workspace metadata leakage.

3. **Do not rely on Turbopack dev mode in this nested parent-workspace layout** unless you also change the repository layout or remove the conflicting parent lockfiles.

4. **If Turbopack dev becomes necessary later**, test one of these structural remedies:
   - move Yantra outside `/Users/t3rpz/projects`
   - remove the parent lockfiles/package root
   - wait for a Next/Turbopack fix that reliably honors `turbopack.root`

## Preventive Measures
- Avoid nesting standalone Next apps inside a parent directory that also has active package roots and lockfiles when relying on Turbopack dev mode.
- Keep a dev smoke test that requests `/` after boot, not just `/api/health`.
- Prefer explicit dev launcher configuration over framework defaults when the repo sits inside a broader workspace tree.
