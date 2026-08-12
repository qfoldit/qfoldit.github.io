# assets/

Local, self-hosted static assets used by index.html and game.html.

## models/

Selectable player characters loaded by `game.html` (see `CHARACTER_LIBRARY` in
`js/game.js`):

| File                       | Key         | Skeleton                          | Bundled animations                 |
|-----------------------------|-------------|------------------------------------|-------------------------------------|
| `creative-mannequin.glb`    | `mannequin` | Unreal-Engine-style (pelvis/spine_01/clavicle_l/...) | `Male_commando_Idle_2` (idle only) |
| `Xbot.glb`                  | `xbot`      | Mixamo (`mixamorig:*`)             | agree, headShake, idle, run, sad_pose, sneak_pose, walk |
| `Ybot.glb`                  | `ybot`      | Mixamo (`mixamorig:*`), identical bone names to Xbot | single baked clip (unused — see below) |

**Why Xbot and Ybot share one animation library:** their skeletons use identical
`mixamorig:*` bone names, so `js/game.js` loads Xbot's idle/walk/run clips once
and applies them to whichever Mixamo-rig mesh is active — Ybot's own single
baked clip is ignored in favor of this shared, named set.

**Known limitation — the mannequin:** its skeleton uses different bone names
than Mixamo (no `mixamorig:*` prefix, different hierarchy/depth), so Xbot's
walk/run clips cannot be retargeted onto it without a real bone-mapping
pipeline. It only ships one idle pose. In `game.html` the mannequin holds that
idle pose while moving — translation, rotation, and multiplayer sync all work
normally, it just won't show a walk/run cycle. To get a full walk/run cycle
for the mannequin, add matching animation clips authored on this same
skeleton (e.g. exported from the same source rig) and wire them up in
`loadCharacterModel()` in `js/game.js`.

Other assets (Font Awesome icons, Google Fonts) still load from third-party
CDNs at runtime and don't need to be vendored here.
