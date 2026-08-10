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
  clampToPressing,
  layoutBands,
  positionToRadius,
  radiusToPosition,
} from "./geometry";
import { type DeckSounds, createDeckSounds, createLazyDeckSounds } from "./sounds";
import { registerDeckSounds } from "./soundSettings";
import { type BandPeaks, paintVinylSurface } from "./surface";
import { DECK_CSS } from "./style";
import { type DeckSkin, skinConfig } from "./skins";
import { SIDE_SECS, type Side, sideAt, sideLabel, splitSides } from "./sides";
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

/**
 * How far the deck magnifies while the headshell is being dragged.
 *
 * Chosen against the thing it exists to make readable. The painter lays grooves
 * at a 1.15px pitch, so at 1x a band on a full twelve-track side is a handful of
 * groove rings and its waveform texture is a suggestion; at 2.2x it is a dozen
 * or so with visibly varying brightness, which is the difference between aiming
 * at a track and aiming at a smudge.
 *
 * Not higher, because the loupe is anchored where you grabbed and the rest of the
 * record has to stay recognisable around it — past roughly this the band you are
 * leaving and the one you are heading for are both off-screen, and a cue you
 * cannot aim in context is no easier than one you cannot see.
 */
export const CUE_ZOOM = 2.2;

/** Plinth furniture. Decorative except for START/STOP and the speed buttons. */
const PLINTH_HTML =
  '<div class="plinth">' +
  '<div class="adaptor"></div>' +
  '<div class="target"></div>' +
  '<div class="power"></div>' +
  // Lower case with spaces around the middot, which is how Technics print it on
  // the cap. It is a depiction of moulded lettering, not a UI label.
  '<button class="start" type="button">start &#183; stop</button>' +
  // Real buttons. Which one is lit comes from state.rate, never from a local
  // toggle — the host owns the rate and may change it from Settings.
  '<div class="speeds">' +
  '<button class="s33" type="button" aria-label="33 rpm">33</button>' +
  '<button class="s45" type="button" aria-label="45 rpm">45</button>' +
  "</div>" +
  // THE TICK SCALE COMES FIRST, and the order is the whole point: both it and the
  // fader are positioned with no z-index, so the later one paints on top. With the
  // scale last, its red zero mark — which deliberately overhangs toward the slot —
  // was drawn ACROSS the fader knob. On the real deck the graduations are printed
  // on the plinth and the fader sits proud of them, so the scale belongs behind.
  // The graduations, numbered. PITCH_RANGE is 8, so the scale runs 8 · 6 · 4 · 2
  // · 0 · 2 · 4 · 6 · 8 from top to bottom — printed unsigned, as the deck does,
  // because the − and + marks beside the fader already say which end is which.
  // Tops are inline so the nine values live in one readable row instead of nine
  // nth-child rules.
  '<div class="pscale">' +
  ["8", "6", "4", "2", "0", "2", "4", "6", "8"]
    .map((n, i) => `<span style="top:${(i * 12.5).toFixed(1)}%">${n}</span>`)
    .join("") +
  "</div>" +
  // The fader. `-` at the top and `+` at the bottom, the Technics way round:
  // you push it away from you to slow the record down. That's the one thing here
  // nobody can guess from the shape, so it's marked.
  '<div class="pitch">' +
  '<span class="pmark pminus">&#8722;</span>' +
  '<span class="pmark pplus">+</span>' +
  '<i></i>' +
  "</div>" +
  '<div class="pval"></div>' +
  '<button class="reset" type="button" aria-label="Reset pitch"></button>' +
  '<div class="rest"></div>' +
  '<div class="foot"></div>' +
  // Bottom right, where the real deck signs itself: a wordmark over the model
  // line. Ours, not the manufacturer's — see the note on `.brand` in style.ts.
  '<div class="brand"><b>Viboplr</b><span>Direct Drive Turntable System</span></div>' +
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
  let stage: HTMLElement;
  let cueRing: HTMLElement;
  let cueReadout: HTMLElement;
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

  /** Previous frame's `stopped`, for the same reason — a stop parks the arm once
   *  rather than pinning every mechanism for as long as the host stays stopped.
   *  See the stop branch in frame(). */
  let wasStopped = false;

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

  /**
   * A cue changed track on a deck that was not running, and the play it implied
   * is being undone.
   *
   * `playQueueIndex` is the contract's only way to change track and it always
   * starts playback, so cueing a paused or stopped deck to a different band would
   * otherwise start the music and — via the rising edge in frame() — drop the arm
   * and clear the motor. Moving the arm is not pressing play: on the desk you cue
   * a stopped deck constantly and it stays stopped.
   *
   * While set, the rising edge is ignored (the sound is this deck's own doing, not
   * an instruction) and the transport is re-asserted until the host agrees. It
   * clears the moment the host reports paused, so it can never latch.
   */
  let restoringCue = false;

  /**
   * The deck's noises, and the state they are derived from.
   *
   * DERIVED FROM THE MECHANISMS, NOT FROM THE INPUTS. The obvious wiring is a
   * sound per click handler, and it is wrong: `armUp` and `motorOff` are also
   * set by frame()'s reconciler, which is how the deck answers a pause from the
   * spacebar or the now-playing bar. Hang the drop off the lever's own click and
   * the arm would come down silently whenever the music was resumed from
   * anywhere else — the picture would move and the sound would not. Comparing
   * the flags frame to frame catches every route into a mechanism, including the
   * ones that have no click at all.
   *
   * Silent until a host grants audio; see `sounds.ts` on why the context is
   * handed in rather than constructed.
   */
  let sounds: DeckSounds = createDeckSounds(null);
  let unregisterSounds: (() => void) | null = null;
  let sndArmUp: boolean | null = null;
  let sndMotorOff: boolean | null = null;
  let sndIndex: number | null = null;

  /**
   * A cue moved a RUNNING deck to another band, and the play that goes with it is
   * still owed.
   *
   * The mirror image of `restoringCue`: that one takes back a play the contract
   * forced, this one supplies a play the contract deferred. `loadQueueIndex` is
   * the only write that can change track and carry a position, and it
   * deliberately does not start anything — so a running deck has to ask for the
   * transport separately, and cannot do it in the same tick.
   *
   * WHY NOT IMMEDIATELY: the host's `setPlaying` bridge drops a request that
   * matches its own live state, and at pointerup that state still says playing —
   * the load has not re-rendered yet. The request would be swallowed and the deck
   * would stand there, arm down, in silence. So the ask waits for the frame where
   * the host actually reports paused, which is the first frame it can be heard.
   */
  let resumingCue = false;

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
   * The last value written to each per-frame DOM property, so a frame that
   * changes nothing costs nothing.
   *
   * frame() runs as often as the host drives it — 60fps on a current host, and
   * the display's full refresh rate (120Hz here) on one from before it capped the
   * loop — while almost nothing it writes changes that often. Playback position
   * advances about four times a second, the speed lamps and the transport classes
   * go whole songs without moving, and the strobe ring is stationary at 33 by
   * design. Measured on the SL-1200 livery over two seconds of uncapped playback:
   * 480 setProperty, 480 transform and 1200 classList.toggle calls, of which only
   * the platter's own rotation genuinely had to happen.
   *
   * Writing a style property is not free even when the value is identical: it
   * goes through the CSSOM, dirties the element, and invites a style recalc. So
   * every per-frame write goes through `styleVar` / `styleTransform` / `cssClass`
   * below and is skipped when it would be a no-op.
   *
   * These caches assume nothing else writes the same properties. Nothing does —
   * repress() writes different ones, and the drag paths write `--deg` through the
   * same helper.
   */
  let wroteDeg = "";
  let wroteSpin = "";
  let wroteDots = "";
  let wroteTravel = "";
  let wrotePval = "";
  let wroteLifted: boolean | null = null;
  let wroteMotorOff: boolean | null = null;
  /** "No record on the platter" — see the empty branch in frame(). */
  let wroteEmpty: boolean | null = null;
  let wroteOffSpeed: boolean | null = null;
  let wroteS33: boolean | null = null;
  let wroteS45: boolean | null = null;

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

  /**
   * What the last pressing painted, so the magnifier can re-rasterise it at a
   * higher resolution without re-running the layout.
   *
   * Re-pressing to repaint would work and would be wrong: `repress` recomputes
   * the geometry, the bands and the arm mount, and a cue drag must not be able
   * to move the pressing it is aiming at.
   */
  let lastPeaks: BandPeaks[] = [];
  let lastEtch: string | null = null;
  /** Titles of the tracks on the pressed side, for the cue readout. Side-relative,
   *  like `bands`, so the two are indexed by the same number. */
  let lastTitles: string[] = [];

  /** Backing-store scale the canvas was last painted at. */
  let paintedScale = 1;

  // --- write-once-per-change helpers. Each returns the value to cache. ---

  function styleVar(el: HTMLElement, prop: string, value: string, last: string): string {
    if (value !== last) el.style.setProperty(prop, value);
    return value;
  }

  function styleTransform(el: HTMLElement, value: string, last: string): string {
    if (value !== last) el.style.transform = value;
    return value;
  }

  function cssClass(el: HTMLElement, name: string, on: boolean, last: boolean | null): boolean {
    if (on !== last) el.classList.toggle(name, on);
    return on;
  }

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
    // SIDE_SECS is what makes the pressing take only the share of the record its
    // running time earns, rather than always filling it — see layoutBands.
    bands = layoutBands(durations, geo, SIDE_SECS);

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
    lastPeaks = onSide.map((t) => t.peaks);
    lastEtch = sideLabel(side);
    lastTitles = onSide.map((t) => t.title);
    // Unconditional, not paintAt(): the bands and the geometry just changed, so
    // the canvas needs redrawing even when the resolution happens to match.
    paint(1);
  }

  /**
   * Re-rasterise the last pressing at `scale` device pixels per CSS pixel.
   *
   * Separate from repress() because the two answer different questions. A
   * pressing changes WHAT is on the record; this changes only how finely it is
   * drawn, and the cue magnifier must never be able to move the bands it is
   * aiming at.
   */
  function paint(scale: number) {
    paintedScale = scale;
    paintVinylSurface(canvas, geo, bands, lastPeaks, lastEtch, scale);
  }

  /** Repaint only if the resolution really changed — a pointermove asks every
   *  frame, and re-rasterising a whole record per frame would drop the drag. */
  function paintAt(scale: number) {
    if (scale !== paintedScale) paint(scale);
  }

  /**
   * How close to the end of a track a cue may land, in seconds.
   *
   * The innermost groove of a band maps to exactly its duration — which is not a
   * position IN that track, it is the boundary with the next one. Seeking there
   * ends the track on the spot and the queue advances, so dropping the needle at
   * the end of a track skipped it entirely; at the end of a SIDE the advance
   * wrapped, which is the other half of why a drop there landed back at the
   * start. `radiusToPosition` can even come back a hair PAST the duration on the
   * float round-trip (209.00000000000006 for a 209s track), which is the same
   * thing only more certain.
   *
   * A second is well under a pixel of band and inaudible as a difference, but it
   * guarantees the drop lands inside the track that was aimed at.
   */
  const CUE_END_MARGIN_SECS = 1;

  /**
   * The position a cue should actually target, given where the needle landed.
   *
   * Used by BOTH the seek and the readout, so the number shown is the number
   * committed — a readout promising 3:29 while the seek delivered something else
   * would be worse than showing nothing.
   */
  function cueTarget(at: { index: number; positionSecs: number }): number {
    const duration = bands[at.index]?.durationSecs ?? 0;
    if (!(duration > 0)) return 0;
    return Math.max(0, Math.min(at.positionSecs, duration - CUE_END_MARGIN_SECS));
  }

  /**
   * mm:ss. Minutes only — a side is 22 minutes, so there is no hour case.
   *
   * ROUNDS rather than floors, unlike an elapsed-time display. This is a target,
   * not a clock: the radius round-trips through the band maths and lands a
   * fraction of a millisecond under, so flooring turns an exact 4:00 into "3:59"
   * — a whole second of apparent error from a rounding artefact, on the one
   * number the user is reading to aim by.
   */
  function clock(secs: number): string {
    const s = Math.max(0, Math.round(secs));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  /**
   * Say where the needle is, in the two terms the user is actually choosing in.
   *
   * The ring is the geometric answer — on a record the position IS the radius, so
   * a circle at that radius names the groove exactly, including the part of it
   * hidden under the headshell. The readout is the human one: a radius is not a
   * track name, and "which song, how far in" is the question a cue is really
   * asking. Neither is decoration; without them you are aiming an opaque block at
   * something you cannot see.
   */
  function showCue(r: number) {
    cueRing.style.width = `${(r * 2).toFixed(1)}px`;
    cueRing.style.height = `${(r * 2).toFixed(1)}px`;

    const at = radiusToPosition(bands, r);
    if (!at) return;
    const title = lastTitles[at.index] ?? "";
    // The absolute queue number, not the side-relative one — it is what the
    // playlist beside the deck is numbered by.
    const n = (side?.start ?? 0) + at.index + 1;
    cueReadout.textContent = `${n}. ${title}  ·  ${clock(cueTarget(at))}`;
  }

  /**
   * Anchor the magnifier on the point being pressed, once, for the whole gesture.
   *
   * THE ANCHOR IS THE PRESS POINT, and that is forced rather than chosen. Under
   * `scale(z)` about origin O a deck point X renders at `z·X + (1−z)·O`, so the
   * point the cursor is over is `X = (R − (1−z)·O) / z` for a cursor at deck
   * position R. Demanding that a stationary cursor keep naming the same groove as
   * z changes — i.e. X = R for all z — gives exactly one solution: O = R. Anchor
   * anywhere else and applying the zoom re-maps the cursor onto a different
   * groove, so the needle slides out from under a hand that has not moved.
   *
   * Anchoring on the STYLUS was the first attempt and it fails twice over. It
   * shifts the needle once when the zoom lands, per the algebra above; and if it
   * is re-aimed each move to follow the needle it becomes a feedback loop, because
   * the stylus is derived from the radius and the radius is measured against the
   * platter as transformed by the anchor. Near the run-out, where the arm's angle
   * changes fastest per unit of radius, that loop diverges — the radius climbs on
   * its own until it clamps at the lead-in, which resolves to track 1 at 0:00. So
   * "let go at the end of the last track" dropped the needle at the start of the
   * side.
   *
   * Read from `deck`, which is never transformed, so this is measurable at any
   * time without the zoom contaminating it.
   */
  function anchorMagnifier(clientX: number, clientY: number) {
    const d = deck.getBoundingClientRect();
    stage.style.transformOrigin =
      `${(clientX - d.left).toFixed(1)}px ${(clientY - d.top).toFixed(1)}px`;
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
    // Anchor the lens NOW, while nothing is transformed yet, and leave it there.
    // The zoom itself waits for the first move; the anchor cannot, because the
    // press point is the only point whose groove survives the zoom unchanged.
    anchorMagnifier(e.clientX, e.clientY);
    // Kills the arm's tracking transition for the duration: a .22s ease is right
    // for a cue jump, but under the cursor it reads as lag.
    deck.classList.add("dragging");
    let zoomed = false;
    // Previous pointer sample, for the scrape's speed. Seeded from the press so
    // the first move is measured against where the hand actually was.
    let lastPt = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    const move = (ev: PointerEvent) => {
      // A stylus dragged across a turning record. Speed-dependent, which is why
      // it is measured here rather than triggered as a one-shot: a slow careful
      // cue should whisper and a flick should scrape.
      const dt = Math.max(1, ev.timeStamp - lastPt.t);
      sounds.scrape((Math.hypot(ev.clientX - lastPt.x, ev.clientY - lastPt.y) / dt) * 1000);
      lastPt = { x: ev.clientX, y: ev.clientY, t: ev.timeStamp };

      const r = clampToPressing(radiusAt(ev.clientX, ev.clientY), bands, geo);
      last = radiusToPosition(bands, r);
      // Follow the pointer NOW rather than waiting for the release to be
      // committed and echoed back by the host. The arm is the thing being
      // dragged, so it has to move with the hand; the host is told on release.
      wroteDeg = styleVar(arm, "--deg", `${armAngleDeg(r, geo, mountPoint).toFixed(2)}deg`, wroteDeg);
      showCue(r);

      // ZOOM IN FOR THE DRAG. A cue is aimed at a band, and at a normal deck size
      // a band on a full side is a few pixels of groove — you are choosing a
      // track by pointing at something you cannot read. Magnifying for the length
      // of the gesture makes the pressing legible exactly while it is being aimed
      // at, and costs nothing the rest of the time.
      //
      // ON THE FIRST MOVE, not on the press: a press that never becomes a drag
      // resolves nothing (see above), so zooming for it would flash the whole
      // deck in and straight back out on every stray click of the headshell.
      //
      // The canvas is re-rasterised to match. Without that this would be a CSS
      // upscale of a fixed bitmap — bigger grooves and no more detail, which is
      // the opposite of the point.
      //
      // The lens itself was anchored on the press point back in onDown, and does
      // not move again for the rest of the gesture — see anchorMagnifier for why
      // that particular point and why nothing else will do.
      if (!zoomed) {
        zoomed = true;
        deck.classList.add("zoomed");
        paintAt(CUE_ZOOM);
      }
    };
    const up = () => {
      dragging = false;
      sounds.endScrape();
      deck.classList.remove("dragging");
      // Back to 1x. The origin is deliberately LEFT where it was: at scale 1 the
      // transform is the identity whatever its origin, so keeping it lets the
      // zoom-out ease from where the lens actually was instead of jumping to the
      // middle first.
      deck.classList.remove("zoomed");
      paintAt(1);
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      if (!last) return;
      // Land on another band -> play it. Land inside the one already playing ->
      // seek within it. The two writes the contract allows, and the two a
      // tonearm needs.
      // `last.index` is side-relative; the host speaks absolute queue indices.
      const queueIndex = (side?.start ?? 0) + last.index;
      // `cueTarget`, not the raw position: the innermost groove of a band maps to
      // exactly its duration, and seeking THERE ends the track instead of playing
      // it. See CUE_END_MARGIN_SECS.
      if (queueIndex === currentIndex) {
        host.actions.seek(cueTarget(last));
        return;
      }

      // A CUE PLACES THE NEEDLE. Whether the music runs from there is the
      // mechanisms' business, not the gesture's — on the desk you cue a stopped
      // deck all the time and it stays stopped, and you cue a running one and it
      // plays on from where you dropped it.
      const running = !motorOff && !armUp;
      // A running deck needs BOTH halves — the cued load and the play that
      // follows it. With only the first it would load the track and stand there
      // in silence, which is worse than the old behaviour it replaces, so a host
      // missing `setPlaying` keeps the play-from-zero fallback instead. A stopped
      // deck never asks for the transport and so never needs the second half.
      const load = host.actions.loadQueueIndex;
      if (typeof load === "function"
        && (!running || typeof host.actions.setPlaying === "function")) {
        // `loadQueueIndex` is the ONLY write that carries a position across a
        // track change — `playQueueIndex` takes an index and nothing else, so a
        // running deck used to hand the host a bare index and get the new track
        // from 0:00, throwing away the groove the readout had just promised.
        // Cue first, ask for the transport second: the two are separate questions
        // and only this order can answer both.
        load.call(host.actions, queueIndex, cueTarget(last));
        // NOT `syncTransport()` here, one frame later — see `resumingCue`. The
        // host's setPlaying bridge compares against its own live `playing`, which
        // still reads as playing this tick, so a request sent now is dropped as a
        // no-op and the deck sits silent with its arm down.
        //
        // `pendingPlay` covers the gap: the load pauses the host, and without it
        // the reconciler would read that silence as someone outside hitting pause
        // and raise the lever on a deck the user is watching play on.
        resumingCue = running;
        pendingPlay = running;
        return;
      }

      host.actions.playQueueIndex(queueIndex);
      // Fallback for a host too old to load without playing. `playQueueIndex` is
      // then the only way to change track and it always starts — so a running
      // deck loses the cue position (there is nowhere to put it), and a stopped
      // one has the transport it just implied undone over the following frames,
      // which lets a fraction of a second of audio out. See `restoringCue`.
      restoringCue = !running;
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
    if (pitch) {
      wroteTravel = styleVar(pitch, "--travel", String(percentToTravel(percent)), wroteTravel);
    }
    if (pval) {
      const text = formatPercent(percent);
      if (text !== wrotePval) pval.textContent = text;
      wrotePval = text;
    }
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

      // LAZY, and the laziness is the point: reading `h.audio` is what opens the
      // device, and sounds are off by default — so the read is deferred to the
      // first settings that turn them on, and for a user who never does, never
      // happens. `registerDeckSounds` below pushes the current settings straight
      // in, so a deck mounted with sounds already on still builds now.
      //
      // A host older than the audio capability, or a platform with no Web Audio,
      // resolves to null and yields a fully-formed silent engine — so nothing
      // below needs a guard either way.
      sounds = createLazyDeckSounds(() => h.audio ?? null);
      unregisterSounds = registerDeckSounds(sounds);

      doc = root.ownerDocument;
      const style = doc.createElement("style");
      style.textContent = DECK_CSS;
      root.append(style);

      deck = doc.createElement("div");
      // `reduce-motion` keeps the magnifier's travel out of the sheet; the zoom
      // itself stays, because it is what makes a cue aimable rather than an
      // embellishment. Set as a class because the shadow boundary the app's own
      // reduced-motion guard cannot cross is the same one this sits behind.
      deck.className =
        `deck lifted skin-${cfg.name}` + (h.reducedMotion ? " reduce-motion" : "");
      deck.style.setProperty("--cue-zoom", String(CUE_ZOOM));
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
      //
      // `.stage` holds both and is the ONLY thing the cue magnifier scales. It
      // has to be its own element: `.deck` carries `overflow: hidden`, and an
      // element's transform applies after its own clip — scaling `.deck` would
      // magnify the clipped picture and spill it across the rest of the view
      // instead of cropping to the slot. With the scale one level in, `.deck`
      // stays the frame and `.stage` moves behind it.
      deck.innerHTML =
        '<div class="stage">' +
        (cfg.furniture ? PLINTH_HTML : "") +
        '<div class="platter">' +
        // Platter rim, with the stroboscope dots as their own element so they can
        // be rotated independently of both the platter and the record.
        (cfg.furniture ? '<div class="rim"><i class="dots"></i></div>' : "") +
        '<div class="body"></div>' +
        '<div class="spin">' +
        // THE SLIPMAT, under the record and shown on its own when there is none.
        // A deck with an empty queue has no record on it — it does not have a
        // blank one, which is a thing that does not exist and read as "loading"
        // or "broken". Inside .spin because a slipmat turns with the platter.
        // The wordmark is printed twice, upright and inverted, exactly as a real
        // one is: a deck gets read from both sides of the booth.
        '<div class="slipmat"><span>Viboplr</span><span>Viboplr</span></div>' +
        "<canvas></canvas>" +
        '<div class="shimmer"></div>' +
        '<div class="label"></div>' +
        "</div>" +
        '<div class="sheen"></div>' +
        '<div class="iris"></div>' +
        '<div class="hole"></div>' +
        // WHERE THE NEEDLE ACTUALLY IS. The headshell is an opaque block that
        // sits directly on top of the one groove it is reading, so the thing you
        // are aiming is the thing you cannot see — and on a record the position
        // IS the radius, so a ring at that radius states it completely. Lives in
        // .platter (not .spin) so it stays put while the record turns under it.
        '<div class="cue-ring"></div>' +
        '<div class="lever"><i></i></div>' +
        // Nested wrappers, one job each, because they need different transforms
        // AND different transitions: arm = tracking rotation (every frame),
        // armlift = depth. Collapsing them makes the slow cue easing smear the
        // per-frame tracking.
        '<div class="armwrap"><div class="armrise"><div class="arm"><div class="armlift">' +
        '<div class="counter"></div><div class="pivot"></div>' +
        '<div class="tube"></div>' +
        (cfg.furniture ? SARM_SVG : "") +
        // `.collar` is the bayonet nut joining shell to tube. A real child rather
        // than a pseudo-element because the shell already spends both of its own
        // on the finger lift and the cartridge.
        '<div class="shadow"></div><div class="head"><i class="collar"></i></div>' +
        "</div></div></div></div>" +
        "</div>" +
        "</div>" +
        // OUTSIDE .stage on purpose: it is the one thing that must NOT magnify.
        // The zoom exists to make the grooves bigger; blowing the label up with
        // them would just push it off the deck, and a readout has no detail to
        // reveal. So it stays put at a fixed size while the record grows.
        '<div class="cue-readout"></div>';
      root.append(deck);

      stage = deck.querySelector(".stage") as HTMLElement;
      cueRing = deck.querySelector(".cue-ring") as HTMLElement;
      cueReadout = deck.querySelector(".cue-readout") as HTMLElement;
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
        // EITHER WAY, not only on the way up. You cannot raise or lower a tonearm
        // that is still clipped to its rest, so operating the lever at all takes
        // it off. Guarded on `armUp` it took three clicks to get the needle down
        // from a parked arm — down (still parked, so still drawn lifted), up
        // (unparked), down — which was invisible while the stop branch was
        // re-parking every frame and became the first thing you hit once it
        // wasn't.
        parked = false;
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
      // The speed buttons and the pitch reset are the only controls whose sound
      // is hung off the click itself, because they change a VALUE rather than a
      // mechanism — there is no flag for frame() to notice moving.
      s33?.addEventListener("click", () => {
        sounds.click("speed");
        setRate(composeRate(1, decomposeRate(rate).percent));
      });
      s45?.addEventListener("click", () => {
        sounds.click("speed");
        setRate(composeRate(R45, decomposeRate(rate).percent));
      });

      pitch = deck.querySelector(".pitch");
      pval = deck.querySelector(".pval");
      pitch?.addEventListener("pointerdown", onPitchDown as EventListener);

      // RESET is the quartz lock: back to exactly the selected speed, however far
      // the fader has been pushed. Keeps the basis, drops the trim.
      deck.querySelector(".reset")?.addEventListener("click", () => {
        // The sprung ball dropping into the centre notch. A real SL-1200 clicks
        // here, and it is the one thing that gives a fader a felt position.
        sounds.click("detent");
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
      // A cue moved the needle on a deck that was not running, and the play that
      // `playQueueIndex` forced along with it is being taken back. Handled ahead
      // of everything else so the rising edge below never sees it as a genuine
      // start — the sound is this deck's own side effect, not an instruction.
      // ONCE, on the edge where that play actually lands — not every frame while
      // it is true. The host's `setPlaying` bridge is a toggle behind a
      // compare-against-live-state guard, so a second request sent before it has
      // re-rendered reads its own stale value and toggles playback back ON.
      if (restoringCue) {
        if (state.playing && !wasPlaying) syncTransport();
        else if (!state.playing) restoringCue = false;
      }

      // The other half of that: a cue on a RUNNING deck loaded a new band cued to
      // the groove it landed on, and now owes it the play. This is the first frame
      // where the host reports the load, and so the first where a play request
      // isn't swallowed as a no-op against its own stale state. See `resumingCue`.
      //
      // Ahead of the branches below for the same reason as `restoringCue`: the
      // silence it is waiting on is this deck's own doing, and must not be read as
      // an instruction to lift the arm.
      // `!state.stopped` and not merely `!state.playing`: a STOP arrives as a
      // frame that is also silent, and this branch sits ahead of the one that
      // brakes the motor — so without the guard a stop landing in the wait window
      // would be answered with the play the cue was owed, and the deck would take
      // itself off its own rest. The stop branch below clears the flag instead.
      if (resumingCue && !state.stopped && !state.playing) {
        resumingCue = false;
        syncTransport();
      }

      if (state.stopped && !wasStopped) {
        // A STOP is a stop, whoever asked for it: the arm comes off the record and
        // back to its rest, and the platter brakes. This is the only thing that
        // parks the arm, which is why the deck's own START/STOP doesn't.
        //
        // ON THE RISING EDGE, NOT THE LEVEL — the same distinction, and for the
        // same reason, as the `playing` branch below. As a level check this
        // re-asserted all three mechanisms on every frame for as long as the host
        // stayed stopped, and the host stays stopped until playback actually
        // resumes (`stopped` clears only on the rising edge of `playing`). So at
        // the end of a queue the deck went dead: the lever set `armUp` and the
        // next frame set it back, START/STOP set `motorOff` and the next frame set
        // it back — along with the `pendingPlay` that would have covered the wait
        // — and a cue drag re-parked the arm the moment the hand let go, which
        // looked like the drag being refused. It wasn't: the cue had already been
        // sent and taken.
        //
        // A stop parks the arm once. After that the deck is a deck again: press
        // START and the platter spins, drop the lever and the needle sits in the
        // groove of a record that isn't turning. Both are ordinary states of the
        // real object, and neither is something the host needs to agree to first.
        motorOff = true;
        armUp = true;
        parked = true;
        pendingPlay = false;
        restoringCue = false;
        // A stop outranks a cue that has not landed yet: the arm is on its rest
        // now, so the play it was owed is no longer owed.
        resumingCue = false;
      } else if (state.playing && !wasPlaying && !restoringCue) {
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
      wasStopped = state.stopped;

      // THE ARM IS UP IF SOMETHING RAISED IT — the lever, or a stop that sent it
      // home. A stopped MOTOR does not: the needle stays in the groove of a record
      // that isn't turning, which is the picture that tells the two apart.
      //
      // Read from the deck's own flags rather than from `playing`, so a control
      // takes effect on the frame it was pressed instead of when the host echoes
      // it back — and, more importantly, so "paused" can't imply "lifted" for the
      // one case where it must not.
      wroteLifted = cssClass(deck, "lifted", armUp || parked, wroteLifted);
      wroteMotorOff = cssClass(deck, "motor-off", motorOff, wroteMotorOff);

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
      // NO RECORD ON THE PLATTER. Not a bail — that is what this used to be, and
      // it returned above the platter's rotation, the strobe, the speed lamps and
      // the sound. So an empty queue froze the deck solid: you could press START,
      // watch the button light and the motor-off class clear, and the record stood
      // still. The mechanisms reconcile ABOVE here, so the picture disagreed with
      // the flags — exactly the deck-drawing-a-lie this file works to avoid.
      //
      // An empty deck is a real object: bare slipmat, spindle, arm on its rest,
      // and a platter that still turns when you start it. Only the parts that
      // need a pressing are skipped.
      const empty = bands.length === 0;
      wroteEmpty = cssClass(deck, "empty", empty, wroteEmpty);

      currentIndex = state.currentIndex;
      // Cleared when there is no record, or the last track's artwork would sit on
      // the slipmat after the queue was emptied.
      const art = empty ? null : state.queue[state.currentIndex]?.artUrl ?? null;
      if (art !== lastArt) {
        lastArt = art;
        label.style.backgroundImage = art ? `url("${art}")` : "";
      }

      // Not while dragging — the hand owns the arm until it lets go.
      if (!dragging) {
        // Nothing to track when there is no record: the arm sits on its rest
        // whatever the transport is doing, which is where it lives on an empty
        // deck. A livery with no rest to draw (`restDeg === null`) simply leaves
        // the arm where it was rather than pointing it at a pressing that isn't
        // there — the alternative would index an empty band table.
        if (empty || parked) {
          if (restDeg !== null) {
            wroteDeg = styleVar(arm, "--deg", `${restDeg.toFixed(2)}deg`, wroteDeg);
          }
        } else {
          // Side-relative, and clamped: while the playing track is on ANOTHER side
          // this pins the arm at that end of the pressing rather than pointing at a
          // band that isn't here.
          const rel = state.currentIndex - (side?.start ?? 0);
          const idx = Math.max(0, Math.min(bands.length - 1, rel));
          const r = positionToRadius(bands, idx, state.positionSecs, geo);
          wroteDeg = styleVar(arm, "--deg", `${armAngleDeg(r, geo, mountPoint).toFixed(2)}deg`, wroteDeg);
        }
      }

      // Which speed is lit — and where the fader sits — both come from the HOST's
      // rate, decomposed. The deck keeps no memory of which button was pressed,
      // so a speed changed in Settings can't leave these describing something
      // that isn't playing. Both lit = 78, exactly how the real deck shows it.
      const pitchState = decomposeRate(rate);
      if (s33) wroteS33 = cssClass(s33, "on", pitchState.basis === 1, wroteS33);
      if (s45) wroteS45 = cssClass(s45, "on", pitchState.basis !== 1, wroteS45);
      // Not while the hand owns it — same rule as the tonearm.
      if (!scrubbingPitch) showPitch(pitchState.percent);
      wroteOffSpeed = cssClass(deck, "off-speed", Math.abs(pitchState.percent) > 0.05, wroteOffSpeed);

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
        wroteSpin = styleTransform(spin, `rotate(${spinAngle}deg)`, wroteSpin);

        // HERE, and not earlier in frame(), because the beds are made of
        // `spinVel` and this is the line that finishes settling it. Driving them
        // from the target instead would make a spin-down an instant silence
        // rather than the sag that IS the sound.
        //
        // First frame arms the trackers rather than firing: mounting a deck that
        // is already playing must not sound like someone just dropped the needle.
        const armedNow = armUp || parked;
        if (sndArmUp !== null && armedNow !== sndArmUp) (armedNow ? sounds.lift() : sounds.drop());
        sndArmUp = armedNow;
        if (sndMotorOff !== null && motorOff !== sndMotorOff) sounds.click("transport");
        sndMotorOff = motorOff;
        // The stylus crossing the land between two bands.
        if (sndIndex !== null && state.currentIndex !== sndIndex) sounds.click("band");
        sndIndex = state.currentIndex;
        // `!empty` on the needle: groove hiss and crackle come from a stylus in
        // vinyl, and there is none. The motor bed is unaffected — a platter with
        // no record on it still turns, and still sounds like it.
        sounds.frame(spinVel, !armedNow && !empty);

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
          wroteDots = styleTransform(dots, `rotate(${dotAngle}deg)`, wroteDots);
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
      // Before the engine goes, or the broadcast would keep a destroyed deck's
      // voices in its set — two slots mount and unmount independently.
      unregisterSounds?.();
      unregisterSounds = null;
      sounds.destroy();
      sounds = createDeckSounds(null);
      sndArmUp = sndMotorOff = null;
      sndIndex = null;
    },
  };
}
