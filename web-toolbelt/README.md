# qFoldIT — Web Toolbelt

A pop-science, multiplayer 3D sandbox for GitHub Pages. Under the hood it's a
standardized qFoldIT WebMCP tool bridge — the same tool contract shared
across qFoldIT's other toolbelts (UEFN, Unity, UNIGINE) — wrapped in a
playful, game-like front end.

Live at: `github.com/qfoldit/qfoldit.github.io/web-toolbelt/`
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
  RCSB Protein Data Bank — the same reference archive CAMEO benchmarks
  blind predictions against — and animates its Cα backbone assembling
  atom by atom. Click any atom to nudge it, or run sim steps to see the
  chain move. This is not a live feed of CAMEO's own weekly leaderboard:
  CAMEO (cameo3d.org) has no public API for that, so pulling it in here
  would mean either scraping without permission or faking the numbers —
  neither of which this does.

- **Guided protocol** — a step-by-step residue-alignment exercise, in
  the spirit of the guided simulation format from qFoldIT member Neil
  Voss's Virtual-Lab-Simulation
  (github.com/qfoldit/Virtual-Lab-Simulation) — an independent
  implementation for this project's own tool contract, not a port of
  that project's source. Load a structure above, start the protocol,
  then click the glowing residue in the scene at each step. Energy/RMSD
  below is a stub pending a connected MCP solver.

- **Version control** — a Lore-compatible (content-addressed,
  revision-chain) history for your experiments — commits, branches, and
  checkout, kept locally and fully portable via JSON. Not a live GitHub
  sync: exporting/importing JSON is the supported way to move history
  between browsers or into a real git repository.

- **Telemetry & tool call log** — live counters (objects, sim steps,
  sim time, players in session) plus a running log of every WebMCP tool
  call made in the session, for watching the tool contract work in
  real time rather than taking it on faith.

## Credits / sources

This toolbelt draws on, and links out to, a few external projects rather
than claiming their work as its own:

| Project | What it's credited for |
|---|---|
| [RCSB Protein Data Bank](https://www.rcsb.org/) | Public API, the real structures behind "Live science data" |
| [Virtual-Lab-Simulation](https://github.com/qfoldit/Virtual-Lab-Simulation) (Neil Voss) | Inspiration for the guided-protocol format — independently implemented here, not a source port |
| [DropleX](https://github.com/skandiz/DropleX) (M. Scandola, with S. Holler, Univ. of Trento) | Droplet-research reference linked from the landing page |

## License

Not stated anywhere in this directory (`qfoldit.github.io/web-toolbelt/`) —
this repo is a companion to `github.com/qfoldit/WEB-TOOLBELT`, which is
AGPL-3.0 with a visible-attribution requirement, but nothing here confirms
this static site inherits that automatically. Worth adding an explicit
`LICENSE` file (or a line in this README) to `qfoldit.github.io` itself
rather than assuming.
