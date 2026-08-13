# assets/

Local, self-hosted static assets used by index.html and game.html.

## models/

Selectable player characters loaded by `game.html` (see `CHARACTER_LIBRARY` in
`js/game.js`):

| File                       | Key         | Skeleton                          | Animation used                        |
|-----------------------------|-------------|------------------------------------|-----------------------------------------|
| `creative-mannequin.glb`    | `mannequin` | Unreal-Engine-style (pelvis/spine_01/clavicle_l/...) | `Male_commando_Idle_2` — idle only |
| `Xbot.glb`                  | `xbot`      | Mixamo (`mixamorig:*`), 67 skin joints | idle, walk, run (own bundled clips) |
| `Ybot.glb`                  | `ybot`      | Mixamo (`mixamorig:*`), 65 skin joints | single unnamed baked clip — used as idle |

**Each character uses only its own bundled clip(s) — no cross-model retargeting.**
An earlier version tried sharing Xbot's idle/walk/run clips with Ybot, on the
assumption that matching `mixamorig:*` bone *names* meant a compatible rig.
In practice Xbot's skin binds 67 joints and Ybot's binds 65 under those same
names, and applying one's clips to the other visibly broke skinning (limbs
detaching from the torso). So that sharing was removed.

**Practical effect:** Xbot has a full idle/walk/run cycle. Ybot and the
mannequin only have an idle pose, so they hold that pose while moving —
translation, rotation, and multiplayer sync all still work correctly, there's
just no walk/run cycle. To get one for either, add a matching walk/run clip
authored on that exact skeleton (e.g. exported from the same source rig) and
name it containing "walk"/"run" so `loadCharacterModel()` in `js/game.js`
picks it up automatically — no other code changes needed.

Other assets (Font Awesome icons, Google Fonts) still load from third-party
CDNs at runtime and don't need to be vendored here.
