# assets/

Reserved for local, self-hosted static assets used by index.html and game.html:
favicons, local textures, or bundled 3D models that should not depend on an
external CDN.

Currently both pages load their character models (glTF) and Font Awesome
icons from third-party CDNs at runtime, so this folder is empty for now.
If any of those assets need to be vendored locally (e.g. for offline use or
to remove a CDN dependency), place them here and reference them with a
relative path such as `assets/models/character.glb`.
