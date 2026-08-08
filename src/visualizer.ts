// The vinyl deck as a plugin visualizer.
//
// It renders host state and owns none of it: the only writes are `seek` and
// `playQueueIndex`, which are exactly the two gestures a tonearm has.
//
// Geometry and painting come from ./geometry and ./surface — the same modules
// the tests exercise. Before this plugin had a build step both had to be
// re-derived by hand in ES5, which is precisely the duplication this replaces.

import type {
  PluginVisualizer,
  PluginVisualizerHost,
  PluginVisualizerSize,
  PluginVisualizerState,
  PluginVisualizerTrack,
} from "../types/viboplr-visualizer";
import {
  type Band,
  armAngleDeg,
  buildArmMount,
  buildGeometry,
  clampToProgram,
  layoutBands,
  positionToRadius,
  radiusToPosition,
} from "./geometry";
import { paintVinylSurface } from "./surface";
import { DECK_CSS } from "./style";
import { type DeckSkin, skinConfig } from "./skins";
import { type Side, sideAt, sideLabel, splitSides } from "./sides";
import {
  RATE_45 as R45,
  composeRate,
  decomposeRate,
  formatPercent,
  percentToTravel,
  travelToPercent,
} from "./pitch";

/**
 * 45rpm expressed against a 33⅓ pressing.
 *
 * The deck's speed buttons don't set an abstract multiplier, they say "play this
 * record at the other speed" — and 45 / 33⅓ is what that ratio is. Pitch rides
 * along on the host side, so it sounds like the record is being misplayed, which
 * is the entire point.
 *
 * Re-exported from ./pitch, which owns the speed maths now that the fader trims
 * these rather than replacing them.
 */
export { RATE_45 } from "./pitch";

/**
 * Platter spin-up and braking time constants, ms.
 *
 * The SL-1200's headline spec is reaching 33⅓ in a third of a turn, and its
 * electronic brake stops it faster still. Exponential easing, so these are ~63%
 * marks: 220ms reaches speed in about half a second, 110ms stops it in a quarter.
 */
const SPINUP_TAU_MS = 220;
const BRAKE_TAU_MS = 110;

/** Plinth furniture. Decorative except for START/STOP and the speed buttons. */
const PLINTH_HTML =
  '<div class="plinth">' +
  '<div class="adaptor"></div>' +
  '<div class="target"></div>' +
  '<div class="power"></div>' +
  '<button class="start" type="button">START&#183;STOP</button>' +
  // Real buttons. Which one is lit comes from state.rate, never from a local
  // toggle — the host owns the rate and may change it from Settings.
  '<div class="speeds">' +
  '<button class="s33" type="button" aria-label="33 rpm">33</button>' +
  '<button class="s45" type="button" aria-label="45 rpm">45</button>' +
  "</div>" +
  // The fader. `-` at the top and `+` at the bottom, the Technics way round:
  // you push it away from you to slow the record down. That's the one thing here
  // nobody can guess from the shape, so it's marked.
  '<div class="pitch">' +
  '<span class="pmark pminus">&#8722;</span>' +
  '<span class="pmark pplus">+</span>' +
  '<i></i>' +
  "</div>" +
  '<div class="pscale"></div>' +
  '<div class="pval"></div>' +
  '<button class="reset" type="button" aria-label="Reset pitch"></button>' +
  '<div class="rest"></div>' +
  '<div class="foot"></div>' +
  '<div class="brand">Direct Drive</div>' +
  "</div>";

/**
 * The S-shaped arm tube.
 *
 * Endpoints are load-bearing: the path starts at the pivot (0,13) and ends at the
 * stylus (100,13), so however the bend is drawn the straight-line distance the
 * geometry solves for is unchanged. `preserveAspectRatio="none"` stretches the
 * viewBox to the arm's real length, which is why the stroke opts out of scaling.
 */
const SARM_SVG =
  '<svg class="sarm" viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden="true">' +
  '<defs><linearGradient id="armgrad" x1="0" y1="0" x2="0" y2="1">' +
  '<stop offset="0" stop-color="#f4f6f8"/>' +
  '<stop offset=".5" stop-color="#c9cbcd"/>' +
  '<stop offset="1" stop-color="#82868b"/>' +
  "</linearGradient></defs>" +
  // Drawn twice: a dark under-stroke for the tube's shaded underside, then the
  // bright one over it. One flat stroke read as wire against the plinth.
  '<path class="under" d="M0,13 C20,13 30,7 52,7 C74,7 80,17 100,13"/>' +
  '<path class="over" d="M0,13 C20,13 30,7 52,7 C74,7 80,17 100,13"/>' +
  "</svg>";

/**
 * The deck, in one of its liveries.
 *
 * `skin` is NOT a setting — each livery is contributed to the host as its own
 * visualizer, so the user picks one from the visualizer picker and this value is
 * fixed for the instance's whole life. That is deliberate: 1.0.1 removed every
 * option and the settings panel with them, and this adds a second deck without
 * bringing any of that back. There is still nothing to configure, no stored
 * preference, and no options object mutated behind a running instance.
 *
 * What each skin may change is presentation and *mounting* — the plinth, the
 * colours, where the platter sits, how long the arm is. What it must not change
 * is the record: the pressing, the groove painting and the cue maths are shared,
 * so both decks agree about where a track is.
 */
export function createVinylDeckVisualizer(skin: DeckSkin = "studio"): PluginVisualizer {
  const cfg = skinConfig(skin);
  let host: PluginVisualizerHost;
  let root: ShadowRoot;
  let deck: HTMLElement;
  let platter: HTMLElement;
  let spin: HTMLElement;
  let canvas: HTMLCanvasElement;
  let label: HTMLElement;
  let arm: HTMLElement;
  let lever: HTMLElement;
  let rest: HTMLElement | null = null;
  let dots: HTMLElement | null = null;
  let s33: HTMLElement | null = null;
  let s45: HTMLElement | null = null;
  let pitch: HTMLElement | null = null;
  let pval: HTMLElement | null = null;

  /**
   * True while the pitch fader is under the hand.
   *
   * Same reason as `dragging` on the tonearm: frame() positions the knob from the
   * host's rate, and the host doesn't know about the drag until we send it, so a
   * frame landing mid-gesture would yank the knob back under the cursor.
   */
  let scrubbingPitch = false;

  /**
   * Platter angle, ACCUMULATED rather than derived from timeMs.
   *
   * `(timeMs / 1800) * 360` is fine at a fixed speed, but multiplying it by the
   * rate makes the whole history rescale, so the record visibly jumps the instant
   * the speed changes. Integrating the delta keeps the picture continuous through
   * a 33 → 45 press, which is what a real platter does — it accelerates, it does
   * not teleport.
   */
  let spinAngle = 0;
  /** Strobe-dot angle, integrated the same way. See frame(). */
  let dotAngle = 0;
  let lastMs: number | null = null;

  /** Last `rate` seen in frame(). Drives the platter's speed, the strobe drift
   *  and which speed button is lit. */
  let rate = 1;

  /**
   * THE DECK'S OWN STATE, and the reason it needs any.
   *
   * A turntable has three independent mechanisms, and each one alone is enough to
   * stop the sound:
   *
   *   motorOff  START/STOP. Brakes the platter. Touches nothing else — in
   *             particular it does NOT lift the arm, which stays in its groove
   *             over a record that is no longer turning.
   *   armUp     The cue lever. Raises the stylus off the record where it stands,
   *             leaving the platter spinning and the arm over its groove.
   *   parked    The arm returned to its rest, clear of the platter. Only a full
   *             stop does this.
   *
   * The host has one `playing` flag and one `stopped` flag, which is enough to
   * drive all three (see frame()) but not to *be* all three: nothing in the host
   * knows whether a pause came from the lever or the motor, because on the host's
   * side there is no such distinction. So this is genuinely the deck's own state,
   * and the only state it keeps.
   *
   * THE INVARIANT, in both directions:
   *   host playing  ==  !motorOff && !armUp
   * Every control here asks for exactly that (see `syncTransport`), and every
   * frame reconciles back to it. A deck that is stopped or lifted while the music
   * plays is a deck drawing a lie.
   */
  let motorOff = false;
  let armUp = false;
  let parked = false;

  /** Previous frame's `playing`, so the flags can be cleared on the rising edge
   *  rather than the level. See frame(). */
  let wasPlaying = false;

  /**
   * The deck has asked for playback and the host hasn't answered yet.
   *
   * `setPlaying` is asynchronous from here, so a request to PLAY is followed by
   * frames that still report paused. Without this the reconciler reads those as
   * "silent with the motor running and the arm down — something outside must have
   * raised the lever" and pops the arm up, one frame after the user pressed START
   * to lower it. The flag says: this silence is mine, I'm waiting on it.
   *
   * Only ever set for a request that both mechanisms agree on, and cleared the
   * moment the host resolves it either way.
   */
  let pendingPlay = false;

  /** Platter speed, eased toward its target so the deck spins up and brakes
   *  instead of snapping. In units where 1 is 33⅓. */
  let spinVel = 1;

  /**
   * True between pointerdown and pointerup on the headshell.
   *
   * While it is set, frame() must NOT write the arm angle. The host's position
   * doesn't change until the drag is committed on release, so frame() would
   * rewrite the angle from the old position on the very next tick and snap the
   * head back under the user's cursor — which read as the arm not moving at all.
   */
  let dragging = false;

  /** The plugin sandbox passes `document: undefined` and a frozen `window`, so
   *  ambient DOM is unavailable by design. Everything comes through the one
   *  handle the contract grants: the shadow root. */
  let doc: Document;

  let geo = buildGeometry(2);
  let mountPoint = buildArmMount(geo);
  let bands: Band[] = [];
  let size: PluginVisualizerSize = { width: 0, height: 0 };

  /**
   * Arm rotation that lays the head on the tonearm rest, or null for a livery
   * that has no rest.
   *
   * Derived in repress() from the SAME `cfg.restAt` that positions the post, so
   * the two cannot disagree. Null everywhere it can't be used: only a deck with
   * furniture has a START/STOP, and START/STOP is the only thing that parks.
   */
  let restDeg: number | null = null;

  let lastRevision = -1;
  /**
   * The side currently pressed onto the record, and nothing else.
   *
   * A long queue can't go on one side: past ~15 bands the pressing stops being
   * legible and past ~20 the band is thinner than the land between bands, at
   * which point a band is too thin to aim a cue drag at. See sides.ts.
   *
   * Everything below works in SIDE-RELATIVE indices — bands, the arm angle, the
   * cue result — and converts at the two host boundaries by adding side.start.
   */
  let side: Side | null = null;
  /** Side start of the last pressing, so crossing a boundary re-presses. */
  let lastSideStart = -1;
  /**
   * The queue cut into sides, recomputed only when the queue itself changes.
   *
   * Cached rather than derived per frame because the cut depends on every
   * duration in the queue, while the only thing that changes between frames is
   * which of these sides we are on.
   */
  let sides: Side[] = [];
  let lastArt: string | null = null;
  let currentIndex = -1;
  const unsubs: (() => void)[] = [];

  /** Lay out and repaint. Called on a queue or size change — never per frame. */
  function repress(tracks: readonly PluginVisualizerTrack[]) {
    // Only this side's tracks are pressed. Slicing here rather than at the call
    // site keeps `bands` and `side` in lockstep by construction.
    const onSide = side ? tracks.slice(side.start, side.start + side.count) : tracks;
    const durations = onSide.map((t) => t.durationSecs);
    // The plinth takes the largest square the slot allows; the record takes the
    // skin's share of it. A bare deck spends the whole box on the disc; one with
    // controls has to leave them room, and that clearance is also what lets it
    // mount the arm at true scale (see skins.ts).
    const box = Math.max(40, Math.min(size.width, size.height));
    const plinthW = box;
    const plinthH = box / cfg.aspect;
    const discBox = Math.max(40, plinthW * cfg.platterScale);
    geo = buildGeometry(discBox);
    mountPoint = buildArmMount(geo, cfg.arm);
    bands = layoutBands(durations, geo);

    deck.style.setProperty("--plinth-w", `${plinthW}px`);
    deck.style.setProperty("--plinth-h", `${plinthH}px`);
    // Furniture is authored against the PLINTH's 368px reference, not the record's
    // — otherwise a skin that shrinks the disc to make room also shrinks the
    // controls it made room for.
    deck.style.setProperty("--pk", String(plinthW / 368));

    // Centred by the deck's flex box, then shifted for skins that put the platter
    // off-centre. Left unset when there's no offset, so the plain deck's platter
    // carries no transform at all — the crop that used to live here is gone and
    // nothing should look like it came back.
    if (cfg.offsetX || cfg.offsetY) {
      platter.style.transform =
        `translate(${cfg.offsetX * plinthW}px, ${cfg.offsetY * plinthH}px)`;
    }

    platter.style.width = `${geo.size}px`;
    platter.style.height = `${geo.size}px`;

    canvas.style.width = `${geo.size}px`;
    canvas.style.height = `${geo.size}px`;
    label.style.width = `${geo.rLabel * 2}px`;
    label.style.height = `${geo.rLabel * 2}px`;

    // Everything in the CSS is authored against a 368px reference deck, so
    // publish the ratio and let those rules scale with calc(). Without this
    // the disc grows but the tonearm's pivot, tube and headshell stay at
    // their original pixel sizes and the arm looks like wire.
    deck.style.setProperty("--k", String(geo.size / 368));

    arm.style.left = `${mountPoint.px}px`;
    arm.style.top = `${mountPoint.py}px`;
    arm.style.width = `${mountPoint.length}px`;

    const k = geo.size / 368;
    const leverW = 11 * k;
    const leverH = 22 * k;
    // Plinth fractions -> the platter's own coordinates. Both boxes are centred on
    // the same point, so the offset is just the difference in their sizes, halved,
    // plus whatever the skin shifts the platter by.
    const platterLeft = (plinthW - geo.size) / 2 + cfg.offsetX * plinthW;
    const platterTop = (plinthH - geo.size) / 2 + cfg.offsetY * plinthH;
    if (cfg.leverAt) {
      // A deck with a plinth has a real place for the lever: beside the arm base,
      // where your hand already is. Nothing clips it when it lands outside the
      // disc — the lever is a child of .platter and only .deck has overflow:
      // hidden.
      lever.style.left = `${cfg.leverAt.x * plinthW - platterLeft - leverW / 2}px`;
      lever.style.top = `${cfg.leverAt.y * plinthH - platterTop - leverH / 2}px`;
    } else {
      // Bottom-right corner, on the 45° diagonal just outside the disc.
      //
      // The corner is the roomiest spot on a square that holds an inscribed
      // circle, and it's the only one the arm never visits: the pivot and its
      // counterweight own the top-right, and the head sweeps down-left of them.
      // Sitting the lever's centre at 1.20·rEdge along the diagonal leaves it
      // well clear of both the vinyl and the slot edge at any deck size.
      const diagonal = geo.rEdge * 1.2 * Math.SQRT1_2;
      // Clamped to the platter box, which is what `.deck { overflow: hidden }`
      // clips against. rEdge is size/2 - 2, so the diagonal alone leaves room at
      // any normal size — but the clamp costs nothing and keeps a very small slot
      // (or a future geometry tweak) from pushing the knob off the edge.
      const inset = 6 * k;
      lever.style.left = `${Math.min(geo.cx + diagonal - leverW / 2, geo.size - leverW - inset)}px`;
      lever.style.top = `${Math.min(geo.cy + diagonal - leverH / 2, geo.size - leverH - inset)}px`;
    }

    // The tonearm rest, and the angle that parks the arm on it — one value, two
    // uses, so the post can never end up somewhere the arm doesn't go. The post
    // is a child of .plinth, so it stays in plinth fractions; the ANGLE needs the
    // pivot, which lives in platter coordinates, hence the conversion.
    //
    // The arm reaches further than the post is far (the stylus is at the tube's
    // far end and a real shell hangs past its rest), so aiming the arm straight
    // down this ray lays the post under the headshell rather than at its tip —
    // which is how an arm actually sits on one.
    if (cfg.restAt && rest) {
      rest.style.left = `${(cfg.restAt.x * 100).toFixed(3)}%`;
      rest.style.top = `${(cfg.restAt.y * 100).toFixed(3)}%`;
      const rx = cfg.restAt.x * plinthW - platterLeft;
      const ry = cfg.restAt.y * plinthH - platterTop;
      restDeg = (Math.atan2(ry - mountPoint.py, rx - mountPoint.px) * 180) / Math.PI;
    }

    // Each band is grooved from its OWN track's waveform, where the host had one
    // cached. Absent peaks fall back to an even groove rather than a blank band,
    // so a queue of streaming tracks still looks like a record.
    paintVinylSurface(canvas, geo, bands, onSide.map((t) => t.peaks), sideLabel(side));
  }

  /**
   * Screen point → groove radius.
   *
   * Measure the PLATTER, never the canvas. The canvas lives inside the spinning
   * layer, and getBoundingClientRect() on a rotated element returns the
   * axis-aligned box of the rotated shape — so its width breathes by up to a
   * factor of root-2 and its origin drifts every frame. Measuring it made every
   * computed radius wrong by a varying amount, which silently broke both cue
   * gestures while the drawing still looked perfect.
   *
   * The unit factor keeps this honest if the platter is ever laid out at a size
   * other than the geometry it was built for.
   */
  function radiusAt(clientX: number, clientY: number): number {
    const rect = platter.getBoundingClientRect();
    const unit = rect.width / geo.size || 1;
    const x = (clientX - rect.left) / unit - geo.cx;
    const y = (clientY - rect.top) / unit - geo.cy;
    return Math.hypot(x, y);
  }

  /**
   * Cue by dragging the headshell. This is the ONLY cue gesture: the record
   * itself is not a control. Pressing the disc used to scrub the grooves, which
   * meant a stray click anywhere on the surface jumped the queue — and made the
   * arm look like something that merely followed along rather than the thing you
   * operate. A tonearm is the handle; the record just turns.
   *
   * Uses pointer capture on the element itself rather than window listeners: the
   * sandbox exposes no ambient `window`, and capture is the right primitive
   * regardless — the drag keeps tracking outside the disc and can't be stolen by
   * another element. (Pointer events, not HTML5 DnD, which the repo bans in this
   * webview.)
   */
  function onDown(e: PointerEvent) {
    if (e.button !== 0 || bands.length === 0) return;
    // No radius guard on the press. The headshell sits at (and visually past)
    // the rim, and while lifted the whole arm is offset, so a real grab often
    // lands outside the program area; the drag itself is clamped instead.
    e.preventDefault();

    const target = e.currentTarget as HTMLElement;
    // Nothing resolves until the pointer actually moves: the press point on the
    // headshell says nothing about a groove, so a click without a drag is a
    // no-op rather than a jump to wherever it landed.
    let last: ReturnType<typeof radiusToPosition> = null;
    dragging = true;
    // Taking hold of the headshell takes the arm off its rest — otherwise the next
    // frame would snap it straight back to the post and the drag would look like
    // it never happened. The motor is left alone: picking the arm up is not
    // touching START/STOP, and the drag ends in a play that starts it anyway.
    parked = false;
    // Kills the arm's tracking transition for the duration: a .22s ease is right
    // for a cue jump, but under the cursor it reads as lag.
    deck.classList.add("dragging");
    const move = (ev: PointerEvent) => {
      const r = clampToProgram(radiusAt(ev.clientX, ev.clientY), geo);
      last = radiusToPosition(bands, r);
      // Follow the pointer NOW rather than waiting for the release to be
      // committed and echoed back by the host. The arm is the thing being
      // dragged, so it has to move with the hand; the host is told on release.
      arm.style.setProperty("--deg", `${armAngleDeg(r, geo, mountPoint).toFixed(2)}deg`);
    };
    const up = () => {
      dragging = false;
      deck.classList.remove("dragging");
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      if (!last) return;
      // Land on another band -> play it. Land inside the one already playing ->
      // seek within it. The two writes the contract allows, and the two a
      // tonearm needs.
      // `last.index` is side-relative; the host speaks absolute queue indices.
      const queueIndex = (side?.start ?? 0) + last.index;
      if (queueIndex === currentIndex) host.actions.seek(last.positionSecs);
      else host.actions.playQueueIndex(queueIndex);
    };
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      // Capture is unavailable in some environments; the element-local
      // listeners still cover a drag that stays over the disc.
    }
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  }

  /**
   * Tell the host what the deck's mechanisms currently add up to.
   *
   * The one place `setPlaying` is called from, so the invariant above can't be
   * violated by a control forgetting a term: a control changes its own mechanism
   * and then asks here, rather than deciding for itself whether music should be
   * playing. That is also why START and the lever can disagree without either
   * being wrong — pressing START with the arm up starts the platter and nothing
   * else, exactly as it would on the desk.
   *
   * States the value rather than toggling, per the contract — a visualizer renders
   * from a snapshot that may be a frame stale, and a toggle read against a stale
   * snapshot inverts. The `typeof` guard keeps an older host without the action
   * degrading to the decorative controls it had before, instead of throwing on
   * every click.
   */
  function syncTransport() {
    if (typeof host.actions.setPlaying !== "function") return;
    const want = !motorOff && !armUp;
    // Only a request to PLAY has a lag window worth covering: a request to pause
    // is already reflected by the flag that caused it, so there is nothing to
    // misread while the host catches up.
    pendingPlay = want;
    host.actions.setPlaying(want);
  }

  /**
   * Ask the host for a playback rate.
   *
   * Guarded like `setPlaying`: a host older than the speed contract has no
   * `setRate`, and there the buttons stay decorative rather than throwing. The
   * host clamps whatever we send and owns the only route back to normal, so this
   * plugin never has to be the thing standing between a user and 1x.
   */
  function setRate(r: number) {
    if (typeof host.actions.setRate !== "function") return;
    host.actions.setRate(r);
  }

  /** Paint the fader knob and its readout for a trim, without asking the host. */
  function showPitch(percent: number) {
    if (pitch) pitch.style.setProperty("--travel", String(percentToTravel(percent)));
    if (pval) pval.textContent = formatPercent(percent);
  }

  /**
   * Drag the pitch fader.
   *
   * Sends on every move rather than on release, because a pitch fader is a
   * continuous control — hearing the record bend as you push it IS the feature,
   * and a value that only landed on mouse-up would be a slider pretending to be a
   * fader. The host clamps, and identical values are dropped so a jittery pointer
   * can't spam the engine.
   *
   * Pointer capture on the element, as everywhere else here: the sandbox exposes
   * no ambient `window`, so window-level drag listeners are impossible — and
   * capture is the better primitive anyway.
   */
  function onPitchDown(e: PointerEvent) {
    if (e.button !== 0 || typeof host.actions.setRate !== "function") return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    // Which speed we're trimming is fixed for the gesture. Re-deriving it from
    // the incoming rate each move would let a big drag cross into the next
    // speed's window and make the fader jump a basis mid-pull.
    const basis = decomposeRate(rate).basis;
    let lastSent = rate;
    scrubbingPitch = true;
    target.setPointerCapture?.(e.pointerId);

    const move = (ev: PointerEvent) => {
      const r = target.getBoundingClientRect();
      if (r.height <= 0) return;
      const percent = travelToPercent((ev.clientY - r.top) / r.height);
      showPitch(percent);
      const next = composeRate(basis, percent);
      // Quantised so a pointer resting still doesn't re-send the same speed.
      if (Math.abs(next - lastSent) > 0.0005) {
        lastSent = next;
        setRate(next);
      }
    };
    const up = () => {
      scrubbingPitch = false;
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
    // Jump to where the press landed, so a click on the slot moves the knob
    // there rather than requiring a drag from wherever it was.
    move(e);
  }

  return {
    mount(h) {
      host = h;
      root = h.root;
      size = h.size;

      doc = root.ownerDocument;
      const style = doc.createElement("style");
      style.textContent = DECK_CSS;
      root.append(style);

      deck = doc.createElement("div");
      deck.className = `deck lifted skin-${cfg.name}`;
      // What rotates matters more than that something rotates. The canvas is
      // nothing but concentric rings, so it is rotationally symmetric and
      // spinning it alone is INVISIBLE. The label (asymmetric art) and the
      // anisotropic shimmer must turn with it — they are what the eye reads as
      // motion. The spindle, the specular sheen and the iridescence stay
      // outside: a real record's glint is fixed by the room light while the
      // grooves turn under it.
      //
      // The plinth comes FIRST so it paints under the platter, and the whole
      // furniture block is absent (not merely hidden) on a skin that has none —
      // so the bare deck's tree is exactly what it was, and the pointer-events
      // reasoning below keeps holding without a second case to check.
      deck.innerHTML =
        (cfg.furniture ? PLINTH_HTML : "") +
        '<div class="platter">' +
        // Platter rim, with the stroboscope dots as their own element so they can
        // be rotated independently of both the platter and the record.
        (cfg.furniture ? '<div class="rim"><i class="dots"></i></div>' : "") +
        '<div class="body"></div>' +
        '<div class="spin">' +
        "<canvas></canvas>" +
        '<div class="shimmer"></div>' +
        '<div class="label"></div>' +
        "</div>" +
        '<div class="sheen"></div>' +
        '<div class="iris"></div>' +
        '<div class="hole"></div>' +
        '<div class="lever"><i></i></div>' +
        // Nested wrappers, one job each, because they need different transforms
        // AND different transitions: arm = tracking rotation (every frame),
        // armlift = depth. Collapsing them makes the slow cue easing smear the
        // per-frame tracking.
        '<div class="armwrap"><div class="armrise"><div class="arm"><div class="armlift">' +
        '<div class="counter"></div><div class="pivot"></div>' +
        '<div class="tube"></div>' +
        (cfg.furniture ? SARM_SVG : "") +
        '<div class="shadow"></div><div class="head"></div>' +
        "</div></div></div></div>" +
        "</div>";
      root.append(deck);

      platter = deck.querySelector(".platter") as HTMLElement;
      spin = deck.querySelector(".spin") as HTMLElement;
      canvas = deck.querySelector("canvas") as HTMLCanvasElement;
      label = deck.querySelector(".label") as HTMLElement;
      arm = deck.querySelector(".arm") as HTMLElement;
      lever = deck.querySelector(".lever") as HTMLElement;
      rest = deck.querySelector(".rest");

      // The HEADSHELL is the only handle on the deck. Not the tube or the
      // counterweight (you don't drag a real tonearm by those), and not the
      // record — pressing the disc is inert.
      (deck.querySelector(".head") as HTMLElement).addEventListener("pointerdown", onDown);

      // THE CUE LEVER RAISES AND LOWERS THE ARM. That is its whole job, and the
      // raised arm is what pauses the music — not the other way round. Lowering it
      // onto a stopped platter therefore starts nothing: `syncTransport` still
      // sees the motor off, which is what would happen on the desk.
      //
      // Taking the arm off the record also takes it off its rest, if it was there.
      //
      // `click`, not `pointerdown`: it's a button, and a press that turns into a
      // drag should not fire it.
      lever.addEventListener("click", () => {
        armUp = !armUp;
        if (armUp) parked = false;
        syncTransport();
      });

      // START/STOP DRIVES THE MOTOR AND NOTHING ELSE, where the livery has one.
      // It does not raise or lower the arm — that is the lever's job, and a big
      // labelled button that silently did the lever's work too is what made the
      // two read as one redundant control. What it does do is stop the sound,
      // because a needle on a stationary record is silent.
      deck.querySelector(".start")?.addEventListener("click", () => {
        motorOff = !motorOff;
        syncTransport();
      });

      // Speed selector. Sets the rate the button names — a state, not a step, so
      // it can't drift out of step with a rate the user changed in Settings.
      dots = deck.querySelector(".dots");
      s33 = deck.querySelector(".s33");
      s45 = deck.querySelector(".s45");
      // Changing speed KEEPS the fader where it is, as on a real deck — the
      // buttons pick the basis, the fader trims it, and pressing 45 doesn't reach
      // over and recentre the slider for you.
      s33?.addEventListener("click", () => setRate(composeRate(1, decomposeRate(rate).percent)));
      s45?.addEventListener("click", () => setRate(composeRate(R45, decomposeRate(rate).percent)));

      pitch = deck.querySelector(".pitch");
      pval = deck.querySelector(".pval");
      pitch?.addEventListener("pointerdown", onPitchDown as EventListener);

      // RESET is the quartz lock: back to exactly the selected speed, however far
      // the fader has been pushed. Keeps the basis, drops the trim.
      deck.querySelector(".reset")?.addEventListener("click", () => {
        setRate(decomposeRate(rate).basis);
      });

      unsubs.push(
        h.onResize((s) => {
          size = s;
          lastRevision = -1; // re-press at the new size
        }),
      );
      // Nothing to re-bake: the surface is painted in alpha only, so a skin
      // change is handled entirely by CSS inheriting through the shadow root.
      unsubs.push(h.onSkinChange(() => {}));
    },

    frame(state: PluginVisualizerState) {
      // RECONCILE THE MECHANISMS AGAINST THE HOST, in the order the states
      // override one another. Each branch is deliberately not a plain level check
      // — see the notes on each.
      //
      // BEFORE THE EMPTY-QUEUE BAIL BELOW. The flags are what the controls read to
      // decide what to ask for, and what the transport classes are drawn from, so
      // letting them go stale over an empty queue would make the deck's first
      // click after one wrong.
      if (state.stopped) {
        // A STOP is a stop, whoever asked for it: the arm comes off the record and
        // back to its rest, and the platter brakes. This is the only thing that
        // parks the arm, which is why the deck's own START/STOP doesn't.
        motorOff = true;
        armUp = true;
        parked = true;
        pendingPlay = false;
      } else if (state.playing && !wasPlaying) {
        // Sound started, however it was started (the lever, START, the spacebar,
        // the next track). Everything that could be stopping it is therefore not.
        //
        // ON THE RISING EDGE, NOT THE LEVEL, and that distinction is the whole bug
        // this once had. `setPlaying` is asynchronous from here: the host has to
        // re-render before `state.playing` flips, and frame() keeps running at
        // display rate meanwhile. Those in-between frames still report playing, so
        // a level check wiped the flags before the pause they were set for ever
        // arrived — and START/STOP silently degraded into a second cue lever.
        motorOff = false;
        armUp = false;
        parked = false;
        pendingPlay = false;
      } else if (!state.playing && !motorOff && !parked && !pendingPlay) {
        // Paused, and this deck isn't the reason. Something outside it stopped the
        // music — the spacebar, the now-playing bar, a track ending — and the only
        // mechanism that could account for silence with the motor still running is
        // a raised arm. So the lever comes up, which is exactly what the user sees
        // when they hit pause anywhere else.
        //
        // A LEVEL CHECK IS CORRECT HERE, unlike the branch above, because it is
        // idempotent: the deck's own lever has already set this, and the guards
        // rule out every state that explains the pause by itself — including the
        // deck's own outstanding play request, which is the one that bites (see
        // `pendingPlay`).
        armUp = true;
      }
      wasPlaying = state.playing;

      // THE ARM IS UP IF SOMETHING RAISED IT — the lever, or a stop that sent it
      // home. A stopped MOTOR does not: the needle stays in the groove of a record
      // that isn't turning, which is the picture that tells the two apart.
      //
      // Read from the deck's own flags rather than from `playing`, so a control
      // takes effect on the frame it was pressed instead of when the host echoes
      // it back — and, more importantly, so "paused" can't imply "lifted" for the
      // one case where it must not.
      deck.classList.toggle("lifted", armUp || parked);
      deck.classList.toggle("motor-off", motorOff);

      // `rate` is absent on a host older than the speed contract; 1 keeps the
      // platter at 33 and the strobe frozen, which is what those hosts do.
      rate = typeof state.rate === "number" && state.rate > 0 ? state.rate : 1;
      // The pressing is the only expensive work, and `queueRevision` is the only
      // thing that can invalidate it (a resize forces it by clearing this).
      // Re-cut the queue only when the queue itself changed; the cut depends on
      // every duration in it, and none of those move between frames.
      if (state.queueRevision !== lastRevision) {
        sides = splitSides(state.queue.map((t) => t.durationSecs));
      }
      // Which side are we on? Re-press when the queue changes OR when playback
      // crosses onto another side — that is a different record face, not a new
      // position on this one.
      side = sideAt(sides, state.currentIndex);
      const sideStart = side?.start ?? -1;
      if (state.queueRevision !== lastRevision || sideStart !== lastSideStart) {
        lastRevision = state.queueRevision;
        lastSideStart = sideStart;
        repress(state.queue);
      }
      if (bands.length === 0) return;

      currentIndex = state.currentIndex;
      const art = state.queue[state.currentIndex]?.artUrl ?? null;
      if (art !== lastArt) {
        lastArt = art;
        label.style.backgroundImage = art ? `url("${art}")` : "";
      }

      // Not while dragging — the hand owns the arm until it lets go.
      if (!dragging) {
        if (parked && restDeg !== null) {
          // On its rest, clear of the platter. It stays there until sound returns.
          arm.style.setProperty("--deg", `${restDeg.toFixed(2)}deg`);
        } else {
          // Side-relative, and clamped: while the playing track is on ANOTHER side
          // this pins the arm at that end of the pressing rather than pointing at a
          // band that isn't here.
          const rel = state.currentIndex - (side?.start ?? 0);
          const idx = Math.max(0, Math.min(bands.length - 1, rel));
          const r = positionToRadius(bands, idx, state.positionSecs, geo);
          arm.style.setProperty("--deg", `${armAngleDeg(r, geo, mountPoint).toFixed(2)}deg`);
        }
      }

      // Which speed is lit — and where the fader sits — both come from the HOST's
      // rate, decomposed. The deck keeps no memory of which button was pressed,
      // so a speed changed in Settings can't leave these describing something
      // that isn't playing. Both lit = 78, exactly how the real deck shows it.
      const pitchState = decomposeRate(rate);
      if (s33) s33.classList.toggle("on", pitchState.basis === 1);
      if (s45) s45.classList.toggle("on", pitchState.basis !== 1);
      // Not while the hand owns it — same rule as the tonearm.
      if (!scrubbingPitch) showPitch(pitchState.percent);
      deck.classList.toggle("off-speed", Math.abs(pitchState.percent) > 0.05);

      // A real platter turns whether or not it's playing. The app's global
      // reduced-motion CSS guard can't cross a shadow boundary, and could never
      // reach a JS-driven rotation, so honour the flag here.
      if (!host.reducedMotion) {
        // Integrate rather than derive from timeMs, so a speed change
        // accelerates the platter instead of teleporting it. dt is clamped
        // because the host stops calling frame() off-screen, and the first tick
        // back would otherwise spin the record through a huge angle at once.
        const dt = lastMs === null ? 0 : Math.max(0, Math.min(250, state.timeMs - lastMs));

        // Ease toward the target speed rather than jumping to it: a direct-drive
        // platter reaches speed in well under a turn and brakes harder still,
        // which is the SL-1200's party trick and the thing that makes START/STOP
        // read as a motor rather than as a second cue lever.
        const target = motorOff ? 0 : rate;
        const tau = target === 0 ? BRAKE_TAU_MS : SPINUP_TAU_MS;
        spinVel += (target - spinVel) * (1 - Math.exp(-dt / tau));
        if (Math.abs(target - spinVel) < 0.001) spinVel = target;

        spinAngle = (spinAngle + (dt / 1800) * 360 * spinVel) % 360;
        spin.style.transform = `rotate(${spinAngle}deg)`;

        // THE STROBE ILLUSION, which is the honest readout of the rate.
        //
        // On a real deck a mains-frequency lamp flashes on the platter's dots, so
        // they look frozen at the correct speed and crawl when it's off. Drifting
        // them by (rate - 1) reproduces exactly that: still at 33, creeping
        // forward at 45, backwards below. It's also why the dots are their own
        // element and not inside .spin — they must not simply turn with the
        // record.
        if (dots) {
          // Drift is (actual speed − the speed the dot ring is cut for), so the
          // ring holds still at 33 and crawls off it. A STOPPED platter's dots
          // don't move at all — they're painted on it — so the reference drops to
          // zero once the motor is off, and the ring sails to a halt with the
          // record. (A real strobe aliases, freezing again at exact multiples;
          // not modelled, because nothing near 33 ever sees it.)
          const reference = spinVel > 0.05 ? 1 : 0;
          dotAngle = (dotAngle + (dt / 1800) * 360 * (spinVel - reference)) % 360;
          dots.style.transform = `rotate(${dotAngle}deg)`;
        }
      }
      lastMs = state.timeMs;
    },

    destroy() {
      for (const u of unsubs) {
        try {
          u();
        } catch {
          // Teardown is best-effort; a throw here would strand the rest.
        }
      }
      unsubs.length = 0;
    },
  };
}
