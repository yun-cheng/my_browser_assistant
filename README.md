# My Browser Assistant (Chrome Extension)

A Chrome side-panel extension that gives you fine-grained control over video playback on any site. It adds keyboard-driven playback controls, a draggable speed overlay, and a streamlined UI for quickly tweaking shortcuts and overlay styling.

## Features

- **Keyboard shortcuts** – Reset, increase/decrease speed, rewind/advance, and toggle the overlay with single-key shortcuts. All defaults are configurable.
- **Dynamic jump steps** – Define multiple rewind/advance step durations (e.g., `2, 5, 10` seconds) and cycle through them with a shortcut.
- **Per-video speed overlay** – Floating badge shows the current playback rate **and** the active rewind/advance step (e.g., `1.3×/10`), can be dragged anywhere (even on videos rendered inside shadow DOM) and auto-adjusts in fullscreen.
- **Custom overlay styling** – Adjust font size, background opacity, and overlay position; temporarily show the overlay even when hidden while changing speeds.
- **Side panel settings** – Chrome side panel groups settings into Playback Controls and Speed Overlay sections for quick edits, including preferred speed and whether to show the overlay by default.

## Project Structure

```
my_browser_assistant/
├─ manifest.json              # Extension manifest (MV3)
├─ sidepanel/
│  ├─ sidepanel.html          # Side panel UI
│  ├─ sidepanel.css           # Side panel styling
│  └─ sidepanel.js            # Settings logic (imports src/lib/settings)
└─ src/
   ├─ background/serviceWorker.js # Manages side panel behavior/toggling
   ├─ content/loader.js           # Injects the main content module
   ├─ content/main.js             # Boots the VideoSpeedFeature
   ├─ features/videoSpeed/        # Controller, overlay, styles
   └─ lib/settings.js             # Storage + defaults for all settings
```

## Default Settings

| Setting                         | Default        | Notes                                                  |
|---------------------------------|----------------|--------------------------------------------------------|
| Reset speed key                 | `a`            | Resets to 1× or toggles preferred speed                |
| Decrease speed key              | `s`            | Single-key decrement                                   |
| Increase speed key              | `d`            | Single-key increment                                   |
| Speed step (increase/decrease)  | `0.1`          | Shared step for both `s` and `d` keys                  |
| Rewind key                      | `z`            | Uses the current rewind/advance step                   |
| Advance key                     | `x`            | Uses the current rewind/advance step                   |
| Cycle rewind/advance key        | `e`            | Toggles step list (default loop: 10 → 2 → 5 → 10)      |
| Rewind/advance step options     | `2, 5, 10`     | Editable comma-separated list of seconds               |
| Current rewind/advance step     | `10`           | Initial active step (shown on overlay)                 |
| Preferred speed                 | `1.3`          | Used when toggling from 1× with the reset key          |
| Show overlay by default         | `true`         | Controls initial overlay visibility                    |
| Toggle overlay key              | `v`            | Shows/hides the overlay                                |
| Overlay font size               | `18px`         | Adjustable via side panel                              |
| Overlay background alpha        | `0.5`          | `rgba(0,0,0, alpha)` background                        |
| Overlay position                | `x:1%, y:5%`   | Stored as ratios so fullscreen keeps relative position |

## Development Setup

1. **Install dependencies (optional)** – The extension code is plain JS; no build step is required. If you want to use tooling, run `npm install` to add any future dev dependencies.
2. **Load the extension**
   - Open `chrome://extensions` in Chrome.
   - Enable **Developer mode**.
   - Click **Load unpacked** and select the `my_browser_assistant` directory.
3. **Test on any video site**. Use the default shortcuts or open the side panel (click the extension icon) to adjust settings.

## Side Panel Usage

- **Playback Controls** – Configure keyboard shortcuts, preferred speed, and step/seek values.
- **Speed Overlay** – Enable/disable the overlay, set the toggle key, update font/background/position, and drag the overlay on any playing video to store its position.

Settings are saved via `chrome.storage.sync`, so they follow you across devices.

## Notes & Tips

- The overlay works on standard videos and shadow DOM-based players (`<hls-video>`, etc.).
- When you adjust speed, the overlay temporarily shows even if hidden, so you always get feedback.
- Position values are stored as percentages; going fullscreen keeps the overlay in the same relative spot.

## Architecture

- **Background service worker** – Registers the side panel and listens for the extension icon click so the panel toggles open/closed per-window.
- **Content module** – Injected on every page and boots the single `VideoSpeedFeature`. It watches the DOM (including shadow roots) for `<video>` elements, instantiates controllers, and dispatches keyboard shortcuts.
- **VideoSpeedController/Overlay** – Each controller wraps a `<video>` element, handles rate/seeking changes, and syncs the draggable overlay (showing `speed/current-step`). The overlay persists ratios so it stays relative in fullscreen.
- **Side panel** – A standalone UI hooked into `chrome.storage.sync`. Settings flow: user input → `sidepanel.js` → `saveSettings` → storage → content script via `subscribeToSettings`.
