# qFoldIT — Web Toolbelt

A pop-science, multiplayer 3D sandbox for GitHub Pages. Under the hood it's a
standardized qFoldIT WebMCP tool bridge — the same tool contract shared
across qFoldIT's other toolbelts (UEFN, Unity, UNIGINE) — wrapped in a
playful, game-like front end.

Live at: `github.com/qfoldit/qfoldit.github.io/web-toolbelt`
Companion repo: `github.com/qfoldit/WEB-TOOLBELT`

## What's here

| Page | What it is |
|---|---|
| `index.html` | Landing page / portal. Links into the sandbox and credits the projects this toolbelt draws on. |
| `game.html` | The sandbox itself: multiplayer 3D world + the qFoldIT Science Lab. |

## Features

**Multiplayer world** — WebSocket-relayed 3D space (Three.js). Nicknames,
per-player chat with history, an interaction menu, a live player graph, and
touch controls (virtual joystick, run/interact buttons) on mobile. Three
selectable characters (Mannequin, Xbot, Ybot) — see
[`assets/README.md`](./assets/README.md) for what each one can and can't
animate, and why.

**qFoldIT Science Lab** — a panel exposing a standardized WebMCP tool
registry (`init_scene`, `spawn_object`, `load_scientific_data`,
`run_simulation_steps`, `get_telemetry`, `capture_viewport`, and more) over
`window.postMessage`, plus direct in-page access via `window.qfoldit.call(...)`.
Everything below is built on top of that same tool contract:

- **Live science data** — loads a real, released structure from the
