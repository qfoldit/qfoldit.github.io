# qFoldIT — Web Toolbelt

A pop-science, multiplayer 3D sandbox for GitHub Pages. Under the hood it's a standardized qFoldIT WebMCP tool bridge — the same tool contract shared across qFoldIT's other toolbelts (UEFN, Unity, UNIGINE) — wrapped in a playful, game-like front end.

Live at: `github.com/qfoldit/qfoldit.github.io/web-toolbelt/`
Companion repo: `github.com/qfoldit/WEB-TOOLBELT`

## What's here

| Page | What it is |
|---|---|
| `index.html` | Landing page / portal. Links into the sandbox and credits the projects this toolbelt draws on. |
| `game.html` | The sandbox itself: multiplayer 3D world + the qFoldIT Science Lab. |
| `e2e.html` | Browser-native end-to-end Scientific Mission lifecycle simulator, from client order intake to simulated player reward settlement. |

## Features

**Multiplayer world** — WebSocket-relayed 3D space (Three.js). Nicknames, per-player chat with history, an interaction menu, a live player graph, and touch controls (virtual joystick, run/interact buttons) on mobile. Three selectable characters (Mannequin, Xbot, Ybot) — see `assets/README.md` for what each one can and can't animate, and why.

**qFoldIT Science Lab** — a standardized WebMCP tool registry (`init_scene`, `spawn_object`, `load_scientific_data`, `run_simulation_steps`, `get_telemetry`, `capture_viewport`, and more) over `window.postMessage`, plus direct in-page access via `window.qfoldit.call(...)`.

- **Live science data** — loads a real, released structure from the RCSB Protein Data Bank and animates its Cα backbone. CAMEO is not presented as a live leaderboard: its public API is not used here.
- **Guided protocol** — a step-by-step residue-alignment exercise. Energy/RMSD feedback remains a stub pending a connected scientific solver.
- **Version control** — a portable, content-addressed revision history for experiments, exported/imported as JSON.
- **Telemetry & tool call log** — live counters and a running log of WebMCP calls.

**End-to-end lifecycle simulator** — `e2e.html` runs on GitHub Pages without a backend. It covers order intake, commercial allocation, simulated escrow, SOS/UAG mission compilation, runtime adapter mapping, player matchmaking, gameplay actions, OpenStructure/CAMEO validation boundaries, Evidence 1.1 packaging, synthetic client acceptance and balanced player reward settlement. The page starts a reference run automatically, shows stage progress, and exports a production-shaped JSON run record. The default target runtime is UEFN/FORTNITE; the browser toolbelt is the simulation harness. A same-origin optional smoke probe can call the existing game page's WebMCP registry and cleans up its temporary marker.

The committed reference output is `data/e2e-reference-run.json`; the contract is defined by `schemas/e2e-run.schema.json`. Every run is explicitly marked as a browser fixture: client/player identities are synthetic, OpenStructure and CAMEO are boundary checks rather than authoritative validator calls, scientific scores remain null, client signatures are absent, and the sandbox ledger never moves real money. `completed_simulation` does not mean production verified.

## Credits / sources

| Project | What it's credited for |
|---|---|
| [RCSB Protein Data Bank](https://www.rcsb.org/) | Public structure reference used by the Science Lab |
| [Virtual-Lab-Simulation](https://github.com/qfoldit/Virtual-Lab-Simulation) (Neil Voss) | Inspiration for the guided-protocol format — independently implemented here, not a source port |
| [DropleX](https://github.com/skandiz/DropleX) (M. Scandola, with S. Holler, Univ. of Trento) | Droplet-research reference linked from the landing page |

## License

Not stated anywhere in this directory (`qfoldit.github.io/web-toolbelt/`) — this repo is a companion to `github.com/qfoldit/WEB-TOOLBELT`, which is AGPL-3.0 with a visible-attribution requirement, but nothing here confirms this static site inherits that automatically. Worth adding an explicit `LICENSE` file (or a line in this README) to `qfoldit.github.io` itself rather than assuming.
