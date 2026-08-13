# fonts/

## What's used, and how it's loaded

`game.html` styles all player-facing nicknames — the floating 3D label above
each character, the player graph, chat, and the interaction menu — with one
condensed display font, referenced throughout `css/game.css` via the
`--font-hud` custom property:

```css
--font-hud: 'Big Shoulders Display', 'Segoe UI', sans-serif;
```

**Big Shoulders Display** is loaded from Google Fonts at runtime
(`@import url('https://fonts.googleapis.com/css2?family=Big+Shoulders+Display...')`
in `css/game.css`) — it is *not* vendored as a local file in this folder.
Because `<canvas>`-drawn text (the 3D nickname label and the player-graph
labels) doesn't pick up a `@font-face` automatically the way regular HTML
text does, `js/game.js` explicitly preloads it via the Font Loading API
(`document.fonts.load(...)`) and redraws those canvases once it's ready.

**License:** SIL Open Font License 1.1 — free for commercial and
non-commercial use, including web embedding. The full license text, with
the font's actual copyright header, is in
[`OFL-big-shoulders-display.txt`](./OFL-big-shoulders-display.txt) in this
folder, matching what the Big Shoulders Project ships in its own repository
(https://github.com/xotypeco/big_shoulders). Designed by Patric King for
the Chicago Design System.

## Why not the actual Fortnite typeface

Two `.otf` files for **Burbank Big Condensed** (Bold and Black) were
provided directly for this project. They were not added here, and that
decision doesn't depend on how the files were obtained (a link vs. a direct
upload doesn't change the underlying rights).

Burbank Big Condensed is a commercial typeface (House Industries) licensed
to Epic Games specifically for Fortnite's own branding. Committing the
actual font files to this repository would mean redistributing a licensed
commercial font to anyone who visits the public site — a different act
than Epic (or anyone else) merely *possessing* a copy of it. Desktop `.otf`
licenses also typically require a separate web-embedding license before a
font can be used via `@font-face` at all, regardless of the file's origin.

`Big Shoulders Display` was chosen as a same-spirit substitute: a free,
properly licensed, bold condensed display face that gives the same chunky
game-HUD read without any of that risk. If a legitimate license for
Burbank Big Condensed (or another Fortnite-branded asset) is obtained for
this project in the future, swap the `--font-hud` value in `css/game.css`
and add the licensed files here with their license — no other code changes
should be needed.
