# qFoldIT — Foldnite Scientific Mission Studio

`Foldnite/` is the dedicated GitHub Pages deployment surface for the qFoldIT UEFN/Foldnite experience.

## Runtime

- Fully client-side and self-contained.
- No backend, Tauri runtime, or filesystem access is required.
- All UI state is held in browser memory.
- The page is designed to run from the repository sub-path `/Foldnite/` without root-relative asset assumptions.

## Included workspaces

- Mission Cockpit
- FASTA Workbench
- LEGO Toolbelt
- Verse IDE
- Verse Generator
- Fortnite Island Studio

## Entry point

`index.html`

The deployment intentionally keeps the Foldnite application isolated from the existing qfoldit.github.io site structure.
