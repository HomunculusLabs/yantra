# CLAUDE.md — Yantra

## Project shape

Yantra is now a **desktop-first Electron app** wrapped around the existing **Next.js UI** and the local **Yantra daemon**.

Main layers:

- `electron/` → Electron main process, runtime spec, first-run seeding
- `src/app` → Next.js UI + API routes
- `server/yantra-daemon.ts` → PTY sessions, jobs, websockets, SQLite bootstrap
- `src/lib/config` → runtime path and root resolution

The daemon is the **only** PTY backend. `server/terminal-server.ts` is legacy and should not come back.

## Core rules

1. Use **Bun-first commands**. Do not reintroduce `npm`, `npx`, `pnpm`, or `yarn` into scripts/docs.
2. Keep desktop safety defaults:
   - Electron renderer: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`
   - daemon host defaults to loopback unless explicitly overridden
3. Keep path resolution centralized in:
   - `src/lib/config/app-paths.ts`
   - `src/lib/config/yantra-roots.ts`
4. Keep DB migration logic centralized in `src/lib/db/bootstrap.ts`.
5. Preserve the current architecture:
   - Next UI on `127.0.0.1:3000`
   - daemon on `127.0.0.1:3001`
   - browser renderer gets daemon websocket URLs from `/api/daemon/auth`
6. Do not add automatic root lifecycle scripts that mutate native binaries. Use `bun run doctor:native` instead.
7. Keep `trustedDependencies`, exact pins, and verification scripts aligned with supply-chain policy.

## Commands

```bash
bun install --frozen-lockfile
bun run verify:supply-chain
bun run dev
bun run build
bun run dist
bun run debug:chrome
```

Useful secondary commands:

```bash
bun run build:web
bun run build:daemon
bun run build:electron
bun run verify:desktop-runtime
bun run doctor:native
```

## Frontend debugging

Use `bun run debug:chrome` for a browser debugging session against `http://127.0.0.1:3000`.

## Editing behavior

- Make targeted edits.
- Preserve markdown/content unless the task explicitly asks for replacement.
- Keep agent/job/session semantics stable when changing desktop/bootstrap code.

## Progress tracking

After every change, append a dated entry to `PROGRESS.md`:

```text
[YYYY-MM-DD] Brief description of what changed in 1-3 sentences.
```
