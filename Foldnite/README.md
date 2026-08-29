# qFoldIT — Foldnite Scientific Mission Studio

This directory contains the GitHub Pages static build of the qFoldIT UEFN/Foldnite frontend.

## Runtime

- Fully client-side static build.
- No backend or filesystem access is required.
- Tauri IPC calls are redirected to an in-browser mock for the static deployment.
- All asset references are relative so the application runs correctly from `/Foldnite/` on GitHub Pages.

## Entry point

`index.html`

## Assets

`assets/` contains the bundled JavaScript and CSS required by the application.

## Screenshots

`screenshots/` contains representative UI states from the build.
