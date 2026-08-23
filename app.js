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

  const svg = document.getElementById("flowerSvg");
  const cornerLeft = document.getElementById("cornerLeft");
  const cornerRight = document.getElementById("cornerRight");
  const hint = document.getElementById("hint");
  const newFlowerBtn = document.getElementById("newFlowerBtn");
  const muteBtn = document.getElementById("muteBtn");
  const genderButtons = Array.from(document.querySelectorAll(".gender-btn"));

  const PETAL_COLORS = ["#f8f4ea", "#f6cdd8", "#f7e3a3"];
  const CENTER_COLORS = ["#eac545", "#e7b23d", "#f0d878"];
  const SHAPES = ["rounded", "pointed", "elongated"];

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

    const count = randInt(7, 35);
    const shape = pick(SHAPES);
    const petalColor = pick(PETAL_COLORS);
    const centerColor = pick(CENTER_COLORS);

    const length = clamp(172 - (count - 7) * 1.05, 128, 172);
    const baseWidth = clamp(66 - (count - 7) * 0.95, 26, 66);
    const width = baseWidth * (SHAPE_WIDTH_SCALE[shape] || 1);
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
      petals.push(createPetal(angle, length + lenJitter, width, shape, petalColor, i));
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

  function createPetal(angleDeg, length, width, shape, color, index) {
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
    path.setAttribute("d", petalPath(shape, length, width));
    path.setAttribute("fill", color);

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

  function clearMessages() {
    cornerLeft.innerHTML = "";
    cornerRight.innerHTML = "";
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
    clearMessages();
    const target = side === "left" ? cornerLeft : cornerRight;
    const p = document.createElement("p");
    p.className = "message-text";
    p.textContent = text;
    target.appendChild(p);
  }

  // ---------- Controls ----------

  genderButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      genderButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.gender = btn.dataset.gender;

      const current = cornerLeft.querySelector(".message-text") || cornerRight.querySelector(".message-text");
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
