# qFoldIT — Foldnite Scientific Mission Studio

`Foldnite/` is the dedicated GitHub Pages deployment surface for the qFoldIT UEFN/Foldnite experience.

## Runtime

- Fully client-side and self-contained.
- No backend, Tauri runtime, filesystem access, or external CSS/JS dependency is required for the published page.
- All interactive UI state is held in browser memory.
- The deployment is path-safe for `/Foldnite/` on GitHub Pages.

## Narrative & Cultural Control

The published Foldnite surface includes the qFoldIT Narrative & Cultural Control Plane shown in the product design reference.

The control plane covers:

- IP and brand selection with rights state.
- Narrative configuration and scientific-fidelity boundary.
- Story Graph connecting mission, discovery, collaboration, validation and asset readiness.
- Character Studio with agency and disclosure states.
- Culture Graph and controlled symbol language.
- Audience segmentation and distribution targets.
- Attention / scientific-action impact metrics.
- Release Gate with a machine-readable narrative manifest.
- Provenance, governance and fail-closed publication indicators.

## Entry point

`index.html`

## Source alignment

The implementation follows the NarrativeControl model defined in `qfoldit/UEFN-QFOLDIT/frontend/src/narrative-control.js`, including the mission-scoped narrative contract, IP rights states, character disclosure, audience, distribution and governance concepts.
