# My Browser Assistant — Tests

Comprehensive integration tests for the Chrome extension using Puppeteer.

## Prerequisites

- **Node.js** (>= 18) with Puppeteer installed
- **Chrome** browser

## Install dependencies

```bash
npm install puppeteer
```

## Run tests

```bash
node tests/test_all_features.mjs
```

The test launches a headed Chrome instance, loads the unpacked extension, and runs all feature tests:

1. Content script injection
2. Speed controls (A, D, S keys)
3. Seek controls (Z, X, E keys)
4. Hold-to fast-forward / slow motion
5. Volume multiplier cycling (Q key)
6. Overlay toggle (V key)
7. Flash overlay on speed change
8. Overlay text format
9. Input field protection
10. Extension health

## Notes

- Tests require a display (headed mode) — won't work in headless CI without Xvfb
- Each test uses real keyboard events via Puppeteer's `page.keyboard` API
- Overlay CSS class transitions are waited for via `waitForFunction` to avoid timing issues