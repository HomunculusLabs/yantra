# Bridge Smoke Plugin

Manual smoke target for the Yantra plugin bridge.

## Intended flow

1. Open Settings → Plugins.
2. Select `Bridge Smoke`.
3. Approve the manifest.
4. Trust locally if you want trusted-local methods.
5. Grant the capabilities you want to exercise.
6. Enable the plugin.
7. Open the workspace view.
8. Use the buttons to invoke bridge methods and inspect the response log.

## Notes

- `desktop.restartDaemon` is exposed for smoke coverage only. Use `soft` first.
- `daemon.session.create` defaults to `general` unless you provide another agent slug.
- The plugin only uses the runtime bridge. It does not rely on same-origin access.
