# Donna DOM integration tests

Run from this directory:

```sh
npm ci --ignore-scripts --cache /tmp/donna-npm-cache
npm test
```

The pinned jsdom dependency is development-only. Donna does not load it at runtime.

The harness evaluates the actual `donna/app.js`, `api.js` and `core.js` ES modules in a jsdom VM. It supplies explicit, synthetic Supabase HTTP fixtures and system speech/dialog/download shims. It never signs into a real account or contacts a live service.

Checks cover navigation, disconnected states, cost calculations, conversational and form teaching with approval/versioning/deletion, authenticated memory envelopes, personal tasks/event exports, speech fallback, owner-data cleanup, explicit deletion, stale requests after logout, safe text rendering, and single-conversation persistence.

These tests do not verify browser layout, Web Speech behavior, iPhone Safari, Siri, on-device model performance, a live Cloudflare Function, or production database configuration. The managed browser tool was unavailable for this task. Actual browser and iPhone testing remains required before deployment.
