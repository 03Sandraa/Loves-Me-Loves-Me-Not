# Project Brief: "Loves Me, Loves Me Not" Web Game

## Concept

A single-page web app version of the classic flower-petal game. A flower appears on screen with a random number of petals. The player pulls petals off one by one. Each petal alternates a message — "loves me" / "loves me not" — and shifts the background color to match the mood. When the last petal falls, the flower has delivered its verdict.

## Core Gameplay Loop

1. A flower renders in the center of the screen with a random petal count.
2. The player clicks (or taps) a petal and drags it away from the flower.
3. On release, the petal detaches and drifts down to the bottom of the screen — slow, floaty fall, not a hard drop.
4. As the petal releases:
   - Odd petals → "[Gender] loves me" appears on screen, background shifts to a brighter, fresher green.
   - Even petals → "[Gender] loves me not" appears on screen, background shifts to a duller, grayer green.
5. Repeat until all petals are gone. The last message shown is the "result."
6. Player can pick a new flower (new random shape + new random petal count) and start again.

## UI Elements

**Top bar:**

- Gender selector: He / She / They — swaps the pronoun used in the on-screen message live, no page reload.
- "New flower" button — generates a fresh flower: new shape, new random petal count, petals reset to attached.

**Main stage:**

- The flower, centered.
- Falling petals drift down and off-screen, then get removed from the DOM — no stacking or pile-up at the bottom. Keeps the animation logic and cleanup simple, and keeps the stage uncluttered on flowers with 30+ petals.
- Message text appears dynamically per pull, styled like the handwritten font in your wireframes.

## Visual Direction (from wireframes)

- Background: soft sage green at rest, shifts to a brighter grass-green on "loves me," and a muted grayish-green on "loves me not." Wireframe 3 shows a vertical gradient version of the "not" state — worth testing both flat color and gradient.
- Flower: soft off-white/cream petals, warm yellow center circle, simple rounded petal shapes (not botanically detailed — more paper-craft/flat illustration style).
- Message text: handwritten/script font, white, positioned in a corner rather than dead-center, so it doesn't block the flower.
- Falling petal: shown mid-air, slight rotation, subtle drop shadow.

## Petal Generation Logic (the trickiest part)

- Petal count is randomized per flower, range 7–35 petals. At the high end (35), petal width needs to shrink and spacing needs to get tighter — worth testing that the "balanced distribution" math still reads clearly at max count, not just at 7–10.
- Petals must be distributed evenly around the center — think "divide 360° by petal count, place each petal at its slice with a bit of randomized jitter so it doesn't look robotic."
- Petals cannot fully overlap or sit in the exact same position — since they're evenly spaced by angle, this is naturally solved, but add a minimum spacing check as a safeguard.
- "Random flower" should also vary: petal shape (rounded vs. pointed vs. elongated), petal color (off-white, soft pink, pale yellow), and center color — so each new flower actually looks different, not just a different petal count.

## Interaction Details

- Chosen: drag-to-pluck, on both desktop (mouse) and touch. This is more build effort than click-to-pluck (needs drag tracking, a release threshold, and a snap-back for aborted drags) but it's the more satisfying gesture and matches the wireframes, so it's worth it.
- Petal should visually detach only once dragged past a distance threshold — otherwise it snaps back to its original position. This stops accidental taps/drags from counting as a pluck.
- Order of plucking doesn't need to matter mechanically: the app tracks "petals removed so far" and alternates the message by that count, not by which specific petal was grabbed. Simplest to build, and the player can't tell the difference anyway.

## Tech Notes for Building in Claude Code

- SVG is a strong fit here: each petal as its own SVG path, positioned via angle math, easy to animate individually (rotate, translate, fade) with CSS transitions or a small animation library.
- Background color transitions: CSS `transition` on a background-color variable is enough — no need for anything heavier.
- "Floaty fall" motion: CSS keyframes with a slight horizontal drift + rotation as the petal falls, rather than a straight vertical drop, will read as much more natural.
- State to track: petal count, petals remaining, current gender selection, current flower "seed" (so re-randomizing produces a new distinct flower).
- Sound: a short, quiet sound effect on each pluck — a soft pop/rustle rather than anything sharp. Keep default volume low, and add a mute toggle since background audio surprises people. Play the sound on release/detach, not on drag-start, so it lines up with the moment the petal actually comes free.

## Decisions Locked In

- Petal count range: 7–35.
- Interaction: drag-to-pluck, mouse and touch.
- Fallen petals: fall off-screen and disappear, no stacking.
- Sound: quiet pluck sound effect, with a mute toggle.
- Copy language: English only, for now.

## Suggested Build Order (MVP first)

1. Static flower render with random petal count (7–35) and balanced spacing, tested at both ends of that range.
2. Drag-to-pluck with release threshold + snap-back, alternating message + background shift by removal count.
3. Falling petal animation (drift + rotation, cleaned up off-screen).
4. Pluck sound effect + mute toggle.
5. Gender selector (He / She / They).
6. "New flower" button with randomized shape/color variety.
