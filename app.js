(() => {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const VIEW_SIZE = 600;
  const CENTER = VIEW_SIZE / 2;
  const DRAG_THRESHOLD = 42; // SVG units a petal must move before it detaches
  const GRAVITY = 260; // SVG units per second^2
  const MAX_PULL_SPEED = 190; // clamp so a fast swipe can't fling a petal absurdly far
  const PULL_DAMPING = 0.5; // softens even a hard/fast pull so the throw feels gentler
  const VELOCITY_WINDOW_MS = 120; // how far back we look to estimate release speed
  const FADE_MS = 450;
  const SAFETY_MAX_ELAPSED = 8000; // ms — hard cap so a petal always eventually cleans up
  const MESSAGE_LIFETIME_MS = 2300; // must match the messageInOut CSS animation duration

  const svg = document.getElementById("flowerSvg");
  const messageLayer = document.getElementById("messageLayer");
  const hint = document.getElementById("hint");
  const newFlowerBtn = document.getElementById("newFlowerBtn");
  const muteBtn = document.getElementById("muteBtn");
  const genderButtons = Array.from(document.querySelectorAll(".gender-btn"));

  const PETAL_COLORS = ["#f8f4ea", "#f6cdd8", "#f7e3a3"];
  const CENTER_COLORS = ["#eac545", "#e7b23d", "#f0d878"];
  const SHAPES = ["rounded", "pointed", "elongated"];

  // Hand-drawn organic petal outlines (traced ellipses, not the formula
  // shapes above). Each is a fixed silhouette rather than a parametric
  // curve, so it's used as-is and just scaled to the flower's petal
  // length — w/h are its native SVG viewBox size, needed to re-anchor it
  // (core edge at the flower center, outer edge as the tip) and scale it.
  const ORGANIC_PETALS = [
    {
      w: 122,
      h: 247,
      d: "M119.295 123.5C106.295 199 92.8795 247 60.2947 247C27.7099 247 9.51145 196 1.29473 123.5C-7.20532 48.5 27.7099 0 60.2947 0C92.8795 0 130.315 59.5 119.295 123.5Z",
    },
    {
      w: 128,
      h: 241,
      d: "M127.465 67.2651C127.465 135.472 95.5778 240.897 68.5159 240.897C41.4539 240.897 -2.40796e-05 137.719 -1.21538e-05 69.5119C-6.89196e-07 -4.72839 28.563 0.0626115 55.6249 0.0626162C82.6869 0.062621 123.315 8.40446 127.465 67.2651Z",
    },
    {
      w: 123,
      h: 210,
      d: "M122.735 61.4585C122.735 129.666 97.5 209.647 61.9657 209.647C26.4315 209.647 0 111.438 0 43.231C0 -24.9762 36.5624 7.94011 63.6243 7.94011C90.6863 7.94011 122.735 -6.7487 122.735 61.4585Z",
    },
  ];

  const state = {
    gender: "She",
    muted: false,
    petalCount: 0,
    petalsRemaining: 0,
    pluckedCount: 0,
    audioCtx: null,
  };

  function rand(min, max) {
    return Math.random() * (max - min) + min;
  }
  function randInt(min, max) {
    return Math.floor(rand(min, max + 1));
  }
  function pick(arr) {
    return arr[randInt(0, arr.length - 1)];
  }
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = randInt(0, i);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  function toRad(deg) {
    return (deg * Math.PI) / 180;
  }

  // ---------- Background mood ----------

  function setMood(mood) {
    const root = document.documentElement.style;
    if (mood === "yes") {
      root.setProperty("--bg-a", "var(--bg-yes-top)");
      root.setProperty("--bg-b", "var(--bg-yes-bottom)");
    } else if (mood === "no") {
      root.setProperty("--bg-a", "var(--bg-no-top)");
      root.setProperty("--bg-b", "var(--bg-no-bottom)");
    } else {
      root.setProperty("--bg-a", "var(--bg-rest-top)");
      root.setProperty("--bg-b", "var(--bg-rest-bottom)");
    }
  }

  // ---------- Sound (synthesized, no external assets) ----------

  function getAudioCtx() {
    if (!state.audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      state.audioCtx = new Ctx();
    }
    return state.audioCtx;
  }

  // A real petal-pluck is two things happening almost at once: a tiny,
  // brittle "tick" as the fiber at the base gives way, and a slightly
  // longer, softer "release" as tension in the stem relaxes — its pitch
  // sagging downward, like a small elastic snap rather than a flat pop.
  function makeNoiseBuffer(ctx, duration, decayPower) {
    const size = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, size, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < size; i++) {
      const decay = Math.pow(1 - i / size, decayPower);
      data[i] = (Math.random() * 2 - 1) * decay;
    }
    return buffer;
  }

  function playPluckSound() {
    if (state.muted) return;
    try {
      const ctx = getAudioCtx();
      if (ctx.state === "suspended") ctx.resume();
      const now = ctx.currentTime;

      // Tick: the fiber snapping — very short, high, brittle.
      const tickDuration = 0.018;
      const tick = ctx.createBufferSource();
      tick.buffer = makeNoiseBuffer(ctx, tickDuration, 1.2);
      const tickFilter = ctx.createBiquadFilter();
      tickFilter.type = "highpass";
      tickFilter.frequency.value = 3200 + Math.random() * 600;
      const tickGain = ctx.createGain();
      tickGain.gain.setValueAtTime(0.0001, now);
      tickGain.gain.exponentialRampToValueAtTime(0.11, now + 0.002);
      tickGain.gain.exponentialRampToValueAtTime(0.0001, now + tickDuration);
      tick.connect(tickFilter);
      tickFilter.connect(tickGain);
      tickGain.connect(ctx.destination);

      // Release: the stem's tension relaxing — a soft body with a pitch
      // that sags downward, like a small elastic snap.
      const bodyDuration = 0.1;
      const body = ctx.createBufferSource();
      body.buffer = makeNoiseBuffer(ctx, bodyDuration, 1.6);
      const bodyFilter = ctx.createBiquadFilter();
      bodyFilter.type = "bandpass";
      bodyFilter.Q.value = 1.2;
      bodyFilter.frequency.setValueAtTime(1500 + Math.random() * 300, now);
      bodyFilter.frequency.exponentialRampToValueAtTime(380 + Math.random() * 80, now + bodyDuration);
      const bodyGain = ctx.createGain();
      bodyGain.gain.setValueAtTime(0.0001, now);
      bodyGain.gain.exponentialRampToValueAtTime(0.16, now + 0.006);
      bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + bodyDuration);
      body.connect(bodyFilter);
      bodyFilter.connect(bodyGain);
      bodyGain.connect(ctx.destination);

      tick.start(now);
      tick.stop(now + tickDuration + 0.02);
      body.start(now);
      body.stop(now + bodyDuration + 0.02);
    } catch (e) {
      // Audio is a nice-to-have; never break the game over it.
    }
  }

  // ---------- Petal path shapes ----------

  // Width multiplier per shape, relative to the flower's base petal width.
  const SHAPE_WIDTH_SCALE = { rounded: 1.15, pointed: 0.95, elongated: 0.8 };

  function petalPath(shape, length, width) {
    const w = width / 2;
    if (shape === "pointed") {
      // Still tapers to a tip, but the body stays broad so it doesn't read as a spike.
      return `M0,0 C${-w},${-length * 0.32} ${-w * 0.6},${-length * 0.8} 0,${-length} ` +
             `C${w * 0.6},${-length * 0.8} ${w},${-length * 0.32} 0,0 Z`;
    }
    if (shape === "elongated") {
      return `M0,0 C${-w * 0.9},${-length * 0.2} ${-w * 0.95},${-length * 0.78} 0,${-length} ` +
             `C${w * 0.95},${-length * 0.78} ${w * 0.9},${-length * 0.2} 0,0 Z`;
    }
    // rounded (default) — broad, blunt tip, paper-craft daisy petal.
    return `M0,0 C${-w},${-length * 0.26} ${-w * 0.9},${-length * 0.7} 0,${-length} ` +
           `C${w * 0.9},${-length * 0.7} ${w},${-length * 0.26} 0,0 Z`;
  }

  // ---------- Flower generation ----------

  function generateFlower() {
    svg.innerHTML = "";
    clearMessages();
    setMood("rest");
    hint.classList.remove("hidden");

    // A flower is either the existing formula-drawn style (itself still
    // varying between rounded/pointed/elongated, as before) or one of
    // the 3 hand-drawn organic shapes — never a mix of both within one
    // flower. Four equally-likely top-level choices.
    const family = pick(["formula", "organic0", "organic1", "organic2"]);
    const shape = family === "formula" ? pick(SHAPES) : null;
    const organicPetal = family.startsWith("organic") ? ORGANIC_PETALS[Number(family.slice(-1))] : null;
    const petalColor = pick(PETAL_COLORS);
    const centerColor = pick(CENTER_COLORS);

    // Thickness is decided first, and the petal count is capped by it —
    // not the other way around. Thin petals can still pack up to the
    // usual 35; chunky ones get a lower ceiling, so a flower full of fat
    // petals never fuses into one solid disc and still reads as a flower.
    const widthMultiplier = rand(0.7, 1.5);
    const maxCount = clamp(Math.round(35 / widthMultiplier), 9, 35);
    const count = randInt(7, maxCount);

    const length = clamp(172 - (count - 7) * 1.05, 128, 172);
    const baseWidth = clamp(66 - (count - 7) * 0.95, 26, 66);
    const width = baseWidth * widthMultiplier * (SHAPE_WIDTH_SCALE[shape] || 1);
    const angleStep = 360 / count;
    const centerRadius = clamp(58 - (count - 7) * 0.15, 40, 58);

    state.petalCount = count;
    state.petalsRemaining = count;
    state.pluckedCount = 0;

    const petals = [];
    for (let i = 0; i < count; i++) {
      const jitter = rand(-angleStep * 0.28, angleStep * 0.28);
      const angle = i * angleStep + jitter;
      const lenJitter = rand(-6, 6);
      petals.push(
        createPetal(angle, length + lenJitter, width, shape, organicPetal, widthMultiplier, petalColor, i)
      );
    }
    // SVG paints in DOM order, so shuffling the append order randomizes
    // which petals overlap which — a more natural, less mechanical stack.
    shuffle(petals);
    for (const g of petals) svg.appendChild(g);

    const centerCircle = document.createElementNS(SVG_NS, "circle");
    centerCircle.setAttribute("class", "center-circle");
    centerCircle.setAttribute("cx", CENTER);
    centerCircle.setAttribute("cy", CENTER);
    centerCircle.setAttribute("r", centerRadius);
    centerCircle.setAttribute("fill", centerColor);
    svg.appendChild(centerCircle);
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function createPetal(angleDeg, length, width, shape, organicPetal, widthMultiplier, color, index) {
    // "pos" carries the petal's on-screen position (world space, used for
    // drag + fall translation). "rot" carries the petal's own orientation
    // (angle + tumble spin). Keeping these as separate nested groups means
    // dragging/falling never has to fight the petal's outward rotation.
    const anchor = document.createElementNS(SVG_NS, "g");
    anchor.setAttribute("class", "petal-anchor");
    anchor.setAttribute("transform", `translate(${CENTER},${CENTER})`);
    anchor.dataset.angle = String(angleDeg);
    anchor.dataset.index = String(index);

    const rotGroup = document.createElementNS(SVG_NS, "g");
    rotGroup.setAttribute("class", "petal-rot-group");
    rotGroup.setAttribute("transform", `rotate(${angleDeg})`);

    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("class", "petal-shape");
    path.setAttribute("fill", color);

    if (organicPetal) {
      // Re-anchor the traced shape into our convention (base at the
      // flower center, tip pointing away). Length always scales from the
      // flower's petal length; width scales that same amount further by
      // the flower's widthMultiplier, so the traced silhouette can come
      // out thinner or chunkier without warping its natural curve.
      const scaleY = length / organicPetal.h;
      const scaleX = scaleY * widthMultiplier;
      path.setAttribute("d", organicPetal.d);
      path.setAttribute(
        "transform",
        `scale(${scaleX}, ${scaleY}) translate(${-organicPetal.w / 2}, ${-organicPetal.h})`
      );
    } else {
      path.setAttribute("d", petalPath(shape, length, width));
    }

    rotGroup.appendChild(path);
    anchor.appendChild(rotGroup);

    attachDragHandlers(anchor, rotGroup, angleDeg);

    return anchor;
  }

  // ---------- Drag-to-pluck ----------
  //
  // A petal can only be pulled outward along its own angle (away from the
  // flower center) — dragging sideways or back toward the center has no
  // effect. We also track recent pointer samples so that at release we know
  // how fast (and confirm which direction) the player pulled, which becomes
  // the petal's initial velocity once it detaches.
  //
  // Move/up/cancel are listened for on the window rather than the petal
  // itself: a fast drag easily carries the pointer off the (thin, rotated)
  // petal shape before the button is released, and per-element listeners
  // would then never see the "up" — leaving the petal stuck wherever it
  // last was. A single shared drag state tracked at the window level always
  // keeps receiving events regardless of where the pointer wanders.

  let activeDrag = null;

  function svgScale() {
    const rect = svg.getBoundingClientRect();
    return VIEW_SIZE / rect.width;
  }

  function outwardFor(drag, clientX, clientY) {
    const dxRaw = (clientX - drag.startX) * drag.scale;
    const dyRaw = (clientY - drag.startY) * drag.scale;
    const o = dxRaw * drag.ux + dyRaw * drag.uy; // projection onto the outward axis
    return Math.max(0, o); // inward/sideways pull is clamped to 0
  }

  function setPetalPos(drag, o) {
    drag.anchor.setAttribute("transform", `translate(${CENTER + o * drag.ux},${CENTER + o * drag.uy})`);
  }

  function releaseVelocity(drag, now, oNow) {
    const cutoff = now - VELOCITY_WINDOW_MS;
    let oldest = null;
    for (const sample of drag.history) {
      if (sample.t >= cutoff) {
        oldest = sample;
        break;
      }
    }
    if (!oldest) oldest = drag.history[drag.history.length - 1];
    if (!oldest) return 0;
    const dt = (now - oldest.t) / 1000;
    if (dt <= 0.001) return 0;
    return (oNow - oldest.o) / dt;
  }

  function endActiveDrag(clientX, clientY) {
    const drag = activeDrag;
    activeDrag = null;
    const now = performance.now();
    const o = outwardFor(drag, clientX, clientY);

    if (o >= DRAG_THRESHOLD) {
      const velocity = releaseVelocity(drag, now, o);
      detachPetal(drag.anchor, drag.rotGroup, drag.angleDeg, drag.ux, drag.uy, o, velocity);
    } else {
      drag.anchor.classList.add("snapping");
      setPetalPos(drag, 0);
    }
  }

  window.addEventListener(
    "pointermove",
    (e) => {
      if (!activeDrag || e.pointerId !== activeDrag.pointerId) return;
      const o = outwardFor(activeDrag, e.clientX, e.clientY);
      setPetalPos(activeDrag, o);
      activeDrag.history.push({ t: performance.now(), o });
      if (activeDrag.history.length > 10) activeDrag.history.shift();
      e.preventDefault();
    },
    { passive: false }
  );

  window.addEventListener("pointerup", (e) => {
    if (!activeDrag || e.pointerId !== activeDrag.pointerId) return;
    endActiveDrag(e.clientX, e.clientY);
  });

  window.addEventListener("pointercancel", (e) => {
    if (!activeDrag || e.pointerId !== activeDrag.pointerId) return;
    endActiveDrag(e.clientX, e.clientY);
  });

  // Last-resort safety net: if focus leaves the window mid-drag (button
  // released outside the browser, alt-tab, etc.) no pointerup may ever
  // arrive — snap the petal home rather than leave it stuck.
  window.addEventListener("blur", () => {
    if (!activeDrag) return;
    const drag = activeDrag;
    activeDrag = null;
    drag.anchor.classList.add("snapping");
    setPetalPos(drag, 0);
  });

  function attachDragHandlers(anchor, rotGroup, angleDeg) {
    const rad = toRad(angleDeg);
    const ux = Math.sin(rad);
    const uy = -Math.cos(rad);

    anchor.addEventListener("pointerdown", (e) => {
      if (anchor.classList.contains("is-falling")) return;
      // Defensive: if a previous drag never got a clean release, snap it
      // home before starting a new one instead of abandoning it mid-air.
      if (activeDrag) {
        activeDrag.anchor.classList.add("snapping");
        setPetalPos(activeDrag, 0);
      }
      anchor.classList.remove("snapping");
      activeDrag = {
        anchor,
        rotGroup,
        angleDeg,
        ux,
        uy,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        scale: svgScale(),
        history: [{ t: performance.now(), o: 0 }],
      };
      e.preventDefault();
    });
  }

  function detachPetal(anchor, rotGroup, angleDeg, ux, uy, startOutward, pullVelocity) {
    anchor.classList.remove("snapping");
    anchor.classList.add("is-falling");
    hint.classList.add("hidden");

    // The petal keeps moving in the direction/speed it was pulled (a throw),
    // then real gravity takes over — so a hard upward yank arcs up briefly
    // before coming back down, instead of just dropping in place.
    const speed = clamp(pullVelocity * PULL_DAMPING, 0, MAX_PULL_SPEED);
    const vx0 = speed * ux;
    const vy0 = speed * uy;
    const startDx = startOutward * ux;
    const startDy = startOutward * uy;

    const wobbleAmplitude = rand(10, 22);
    const wobblePhase = rand(0, Math.PI * 2);
    const spinSpeed = rand(30, 80) * (Math.random() < 0.5 ? -1 : 1) + speed * 0.2 * Math.sign(ux || 1);

    const startTime = performance.now();
    let fadeStartTime = null;

    function frame(now) {
      const elapsed = now - startTime;
      const t = elapsed / 1000;

      const x = startDx + vx0 * t + Math.sin(t * 2.4 + wobblePhase) * wobbleAmplitude;
      const y = startDy + vy0 * t + 0.5 * GRAVITY * t * t;
      const spin = angleDeg + t * spinSpeed;

      anchor.setAttribute("transform", `translate(${CENTER + x},${CENTER + y})`);
      rotGroup.setAttribute("transform", `rotate(${spin})`);

      const worldY = CENTER + y;
      if (fadeStartTime === null && worldY > VIEW_SIZE + 20) {
        fadeStartTime = now;
      }

      if (fadeStartTime !== null) {
        const fadeT = clamp((now - fadeStartTime) / FADE_MS, 0, 1);
        anchor.style.opacity = String(1 - fadeT);
        if (fadeT >= 1) {
          anchor.remove();
          return;
        }
      }

      if (elapsed > SAFETY_MAX_ELAPSED) {
        anchor.remove();
        return;
      }

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
    playPluckSound();
    onPluck();
  }

  // ---------- Messages / mood per pluck ----------

  // Two fixed, reserved spots: "loves me" always bottom-left, "loves me
  // not" always bottom-right — each held well clear of the screen edges
  // by a fixed margin (with a little jitter so it's not pixel-identical
  // every time, but always in that corner).
  function messageZone(side) {
    const marginSide = rand(6, 9.5);
    const marginBottom = rand(9, 14);
    return side === "left"
      ? { side, left: marginSide, bottom: marginBottom }
      : { side, right: marginSide, bottom: marginBottom };
  }

  function clearMessages() {
    messageLayer.innerHTML = "";
  }

  // If a message is still mid-flight (hasn't finished its own fade-out)
  // when a new pluck arrives, let it drop out of view instead of just
  // popping away. Freezing its current transform/opacity as inline
  // styles first means the fall continues smoothly from wherever it
  // already was, instead of jumping back to some default state.
  function dismissCurrentMessage() {
    const existing = messageLayer.querySelector(".message-text");
    if (!existing) return;
    const cs = getComputedStyle(existing);
    existing.style.transform = cs.transform;
    existing.style.opacity = cs.opacity;
    existing.classList.add("is-dismissed");
    setTimeout(() => existing.remove(), 450);
  }

  function verbFor(gender) {
    return gender === "They" ? "love" : "loves";
  }

  function onPluck() {
    state.pluckedCount += 1;
    state.petalsRemaining -= 1;

    const isLovesMe = state.pluckedCount % 2 === 1;
    const verb = verbFor(state.gender);
    const text = isLovesMe
      ? `${state.gender} ${verb} me`
      : `${state.gender} ${verb} me not`;

    setMood(isLovesMe ? "yes" : "no");
    showMessage(text, isLovesMe ? "left" : "right");
  }

  function showMessage(text, side) {
    dismissCurrentMessage();
    const p = document.createElement("p");
    p.className = "message-text";
    p.textContent = text;

    const zone = messageZone(side);
    p.style.textAlign = zone.side;
    if (zone.left !== undefined) p.style.left = `${zone.left}%`;
    if (zone.right !== undefined) p.style.right = `${zone.right}%`;
    p.style.bottom = `${zone.bottom}%`;

    // A real quadratic-bezier hook, mirrored per side: it rises from
    // below first (staying out toward its own side), then curves inward
    // late to settle in its spot — not a straight-line slide.
    const dir = side === "left" ? -1 : 1;
    const sx = dir * rand(75, 115);
    const sy = rand(110, 155);
    const cx = sx * 0.85;
    const cy = sy * 0.12;
    const tilt = Math.random() < 0.4 ? rand(4, 9) * (Math.random() < 0.5 ? -1 : 1) : 0;
    p.style.setProperty("--sx", sx.toFixed(1));
    p.style.setProperty("--sy", sy.toFixed(1));
    p.style.setProperty("--cx", cx.toFixed(1));
    p.style.setProperty("--cy", cy.toFixed(1));
    p.style.setProperty("--tilt", tilt.toFixed(1));

    p.addEventListener("animationend", () => p.remove());
    // Belt-and-suspenders: some browsers can be slow to dispatch
    // animationend on a backgrounded/inactive tab, so a plain timer
    // guarantees the message still clears itself after ~3s.
    setTimeout(() => p.remove(), MESSAGE_LIFETIME_MS);
    messageLayer.appendChild(p);
  }

  // ---------- Controls ----------

  const genderActiveHex = document.getElementById("genderActiveHex");

  genderButtons.forEach((btn, index) => {
    btn.addEventListener("click", () => {
      genderButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.gender = btn.dataset.gender;

      if (genderActiveHex) {
        genderActiveHex.style.transform = `translateX(${index * btn.offsetWidth}px)`;
      }

      const current = messageLayer.querySelector(".message-text:not(.is-dismissed)");
      if (current && state.pluckedCount > 0) {
        const isLovesMe = state.pluckedCount % 2 === 1;
        const verb = verbFor(state.gender);
        current.textContent = isLovesMe
          ? `${state.gender} ${verb} me`
          : `${state.gender} ${verb} me not`;
      }
    });
  });

  newFlowerBtn.addEventListener("click", generateFlower);

  muteBtn.addEventListener("click", () => {
    state.muted = !state.muted;
    muteBtn.classList.toggle("is-muted", state.muted);
    muteBtn.setAttribute("aria-pressed", String(state.muted));
    muteBtn.title = state.muted ? "Unmute sound" : "Mute sound";
  });

  generateFlower();
})();
