# Yantra

**Your knowledge base. Your AI team. Now desktop-first.**

Yantra is a local-first startup OS built on markdown files, a local daemon, and an Electron shell around the existing Next.js UI. Your vault stays on disk, your runtime stays local, and the app feels like a real Mac desktop app instead of a browser tab.

## Quick start

### Source checkout

Requirements:

- Bun `1.2.22`
- Node `22.x`
- macOS or Linux

```bash
bun install --frozen-lockfile
bun run verify:supply-chain
bun run dev
```

That launches the Electron shell, which manages:

- the Next.js UI on `127.0.0.1:3000`
- the Yantra daemon on `127.0.0.1:3001`

## Architecture

Yantra now has three layers:

1. **Electron shell** — desktop window, lifecycle, startup/shutdown orchestration
2. **Next.js app** — UI, API routes, editor, sidebar, search, panels
3. **Yantra daemon** — PTY sessions, jobs, websockets, SQLite bootstrap, agent runtime

Key paths:

```text
electron/                Electron main/runtime/seed code
src/app/                 Next.js UI + API routes
server/yantra-daemon.ts  Local daemon backend
src/lib/config/          Runtime path + roots config
scripts/                 Desktop staging and verification scripts
```

## Bun-first and supply-chain hardening

This repo now treats Bun as the package manager authority:

- `packageManager` is pinned to `bun@1.2.22`
- direct dependencies are exact-pinned
- `bun.lock` is canonical
- `bunfig.toml` enforces exact saves, frozen lockfile, and a minimum release age
- `trustedDependencies` is explicitly allowlisted
- `bun run verify:supply-chain` fails if unsafe package-runner or lifecycle patterns come back

Native recovery is manual, not automatic:

```bash
bun run doctor:native
```

## Desktop build flow

```bash
bun run build            # build web + daemon + electron + staged runtime
bun run dist             # package desktop app with electron-builder
```

The staged desktop runtime is validated by:

```bash
bun run verify:desktop-runtime
```

## Optional browser/container flow

Yantra still supports a browser-first deployment if you want it:

```bash
bun run build:web
bun run build:daemon
bun run start:web
bun run start:daemon
```

In container/reverse-proxy mode, set `YANTRA_DAEMON_HOST=0.0.0.0`.

## Configuration

Use `.env.example` as the starting point. Desktop builds seed `.env.local` into the user config directory automatically on first launch.

Important variables:

- `KB_PASSWORD`
- `DOMAIN`
- `YANTRA_DAEMON_HOST`
- `YANTRA_DAEMON_PUBLIC_ORIGIN`
- `ABSURD_DATABASE_URL`
- `YANTRA_ABSURD_QUEUE`

## Debugging

To debug the browser UI in a normal browser session:

```bash
bun run debug:chrome
```

## License

MIT
