# Loves Me, Loves Me Not 🌸

A cozy, browser-based take on the classic flower-petal game. Pull petals off a hand-illustrated flower one by one — each one flips the verdict between "loves me" and "loves me not" — until the last petal decides your fate.

**[Play it here](https://03sandraa.github.io/Loves-Me-Loves-Me-Not/)**

## Features

- **Drag-to-pluck petals** — grab a petal and pull it outward past a threshold to detach it; let go too early and it snaps back. Works with mouse and touch.
- **Every flower is unique** — petal count, shape family (rounded, pointed, elongated, or one of several hand-traced organic silhouettes), color, and thickness are all randomized per flower.
- **Floaty, physics-driven fall** — a plucked petal keeps the direction and speed it was pulled with, arcs under gravity, tumbles, and fades out as it drifts off-screen.
- **Gender selector** — ♀ / ♂ / ○ (She / He / They), swapped live without a page reload, updating every message's pronoun.
- **Mood-reactive background** — the whole scene shifts color depending on whether the last pull was "loves me" or "loves me not."
- **A verdict screen** — once the last petal falls, a framed card drops in with the flower's answer (and, on a win, a random nudge to actually go say something).
- **Quiet synthesized sound** — a soft pluck sound on release, generated in-browser (no audio files), with a mute toggle.
- **Responsive, mobile-first touches** — on small screens the flower trades its drop shadow for a thin outline per shape, the page locks to `100dvh` so it never scrolls, and on-screen text stays on one line.

## Tech

Plain HTML, CSS, and vanilla JavaScript — no build step, no dependencies, no framework. Petals are individual SVG paths positioned with angle math; the fall animation runs on `requestAnimationFrame`; sound is synthesized on the fly with the Web Audio API.

```
index.html    markup + inline SVG sprite sheet (buttons, sign, icons)
app.js        flower generation, drag physics, sound, game state
styles.css    layout, theming, animations
assets/       background texture overlay
```

## Running locally

No build tools needed — any static file server works:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Credits

Built with [Claude Code](https://claude.com/claude-code).
