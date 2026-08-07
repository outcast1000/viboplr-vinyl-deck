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
  type VinylComposition,
  armAngleDeg,
  buildArmMount,
  buildCrop,
  buildGeometry,
  clampToProgram,
  layoutBands,
  positionToRadius,
  radiusToPosition,
} from "./geometry";
import { paintVinylSurface } from "./surface";
import { DECK_CSS } from "./style";

/**
 * Presentation-only options, shared **by reference** with the plugin.
 *
 * The host re-mounts a visualizer only when the slot's *selection* changes, so a
 * settings change can't arrive as a new mount. Handing over a live object the
 * plugin mutates is how a running deck picks up a new tilt on its next frame.
 */
export interface DeckOptions {
  composition: VinylComposition;
  tilt: number;
  emphasiseGaps: boolean;
}

export function createVinylDeckVisualizer(options: DeckOptions): PluginVisualizer {
  let host: PluginVisualizerHost;
  let root: ShadowRoot;
  let deck: HTMLElement;
  let platter: HTMLElement;
  let spin: HTMLElement;
  let canvas: HTMLCanvasElement;
  let label: HTMLElement;
  let arm: HTMLElement;
  let gapLayer: HTMLElement;
  let lever: HTMLElement;

  /** Last `playing` seen in frame(). The lever states the value it wants rather
   *  than toggling, per the contract, so it has to know the current one. */
  let playing = false;

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

  let lastRevision = -1;
  let lastArt: string | null = null;
  let lastApplied = "";
  let currentIndex = -1;
  const unsubs: (() => void)[] = [];

  /** Lay out and repaint. Called on a queue or size change — never per frame. */
  function repress(tracks: readonly PluginVisualizerTrack[]) {
    const durations = tracks.map((t) => t.durationSecs);
    const box = Math.max(40, Math.min(size.width, size.height));
    geo = buildGeometry(box);
    mountPoint = buildArmMount(geo);
    bands = layoutBands(durations, geo);

    const crop = buildCrop(options.composition, geo);
    // The crop trades the disc's redundant angular symmetry for magnification;
    // centre whatever window it produces inside the slot we were given.
    platter.style.width = `${geo.size}px`;
    platter.style.height = `${geo.size}px`;
    platter.style.transform =
      crop.zoom === 1
        ? ""
        : `scale(${crop.zoom}) translate(${crop.left / crop.zoom}px, ${crop.top / crop.zoom}px)`;

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

    // Bottom-right corner, on the 45° diagonal just outside the disc.
    //
    // The corner is the roomiest spot on a square that holds an inscribed
    // circle, and it's the only one the arm never visits: the pivot and its
    // counterweight own the top-right, and the head sweeps down-left of them.
    // Sitting the lever's centre at 1.20·rEdge along the diagonal leaves it well
    // clear of both the vinyl and the slot edge at any deck size.
    const k = geo.size / 368;
    const leverW = 11 * k;
    const leverH = 22 * k;
    const diagonal = geo.rEdge * 1.2 * Math.SQRT1_2;
    // Clamped to the platter box, which is what `.deck { overflow: hidden }`
    // clips against. rEdge is size/2 - 2, so the diagonal alone leaves room at
    // any normal size — but the clamp costs nothing and keeps a very small slot
    // (or a future geometry tweak) from pushing the knob off the edge.
    const inset = 6 * k;
    const leverX = Math.min(geo.cx + diagonal - leverW / 2, geo.size - leverW - inset);
    const leverY = Math.min(geo.cy + diagonal - leverH / 2, geo.size - leverH - inset);
    // Follow the arm across the mirror. The cropped composition flips .armwrap
    // so the playhead survives, but the lever isn't inside it — left unmirrored
    // it would sit on the far side from the arm it operates, and in fact off the
    // visible area entirely (the crop cuts everything past ~0.68·size).
    lever.style.left = `${crop.mirrorArm ? geo.size - leverX - leverW : leverX}px`;
    lever.style.top = `${leverY}px`;
    // Mirror the arm for a left-hand crop so the playhead survives it.
    deck.classList.toggle("mirror-arm", crop.mirrorArm);

    // Each band is grooved from its OWN track's waveform, where the host had one
    // cached. Absent peaks fall back to an even groove rather than a blank band,
    // so a queue of streaming tracks still looks like a record.
    paintVinylSurface(canvas, geo, bands, tracks.map((t) => t.peaks));
    renderGapRings();
  }

  function renderGapRings() {
    gapLayer.textContent = "";
    if (!options.emphasiseGaps) return;
    for (let i = 0; i < bands.length - 1; i++) {
      const d = (bands[i].inner - (bands[i].inner - bands[i + 1].outer) / 2) * 2;
      const ring = doc.createElement("div");
      ring.className = "gap-ring";
      ring.style.width = `${d}px`;
      ring.style.height = `${d}px`;
      gapLayer.append(ring);
    }
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
   * The platter carries the crop's scale, so one factor is still right for every
   * composition.
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
      if (last.index === currentIndex) host.actions.seek(last.positionSecs);
      else host.actions.playQueueIndex(last.index);
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
      deck.className = "deck lifted";
      // What rotates matters more than that something rotates. The canvas is
      // nothing but concentric rings, so it is rotationally symmetric and
      // spinning it alone is INVISIBLE. The label (asymmetric art) and the
      // anisotropic shimmer must turn with it — they are what the eye reads as
      // motion. The spindle, the specular sheen and the iridescence stay
      // outside: a real record's glint is fixed by the room light while the
      // grooves turn under it.
      deck.innerHTML =
        '<div class="platter">' +
        '<div class="body"></div>' +
        '<div class="spin">' +
        "<canvas></canvas>" +
        '<div class="shimmer"></div>' +
        '<div class="label"></div>' +
        "</div>" +
        '<div class="sheen"></div>' +
        '<div class="iris"></div>' +
        '<div class="gaps"></div>' +
        '<div class="hole"></div>' +
        '<div class="lever"><i></i></div>' +
        // Four nested wrappers, one job each, because they need different
        // transforms AND different transitions: armwrap = mirror for a
        // left-hand crop, armrise = screen-space lift, arm = tracking
        // rotation (every frame), armlift = depth. Collapsing any two makes
        // the slow cue easing smear the per-frame tracking.
        '<div class="armwrap"><div class="armrise"><div class="arm"><div class="armlift">' +
        '<div class="counter"></div><div class="pivot"></div>' +
        '<div class="tube"></div><div class="shadow"></div><div class="head"></div>' +
        "</div></div></div></div>" +
        "</div>";
      root.append(deck);

      platter = deck.querySelector(".platter") as HTMLElement;
      spin = deck.querySelector(".spin") as HTMLElement;
      canvas = deck.querySelector("canvas") as HTMLCanvasElement;
      label = deck.querySelector(".label") as HTMLElement;
      arm = deck.querySelector(".arm") as HTMLElement;
      gapLayer = deck.querySelector(".gaps") as HTMLElement;
      lever = deck.querySelector(".lever") as HTMLElement;

      // The HEADSHELL is the only handle on the deck. Not the tube or the
      // counterweight (you don't drag a real tonearm by those), and not the
      // record — pressing the disc is inert.
      (deck.querySelector(".head") as HTMLElement).addEventListener("pointerdown", onDown);

      // The cue lever. Its raised state already IS the paused state (see
      // frame()), so the only honest thing for a click to do is drive playback —
      // animating a lift while the music kept going would be a lie.
      // `click`, not `pointerdown`: it's a button, and a press that turns into a
      // drag should not fire it.
      lever.addEventListener("click", () => {
        // Guard the newer action so an older host degrades to the decorative
        // lever it had before, rather than throwing every click.
        if (typeof host.actions.setPlaying !== "function") return;
        host.actions.setPlaying(!playing);
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
      // Before the empty-queue bail below: the lever reads this to decide what
      // to ask for, and a stale value would make its first click a no-op.
      playing = state.playing;
      // Settings are shared by reference, so fold them into the same cheap
      // "does the expensive work need redoing?" check as the queue.
      const applied = `${options.composition}|${options.emphasiseGaps}`;
      if (state.queueRevision !== lastRevision || applied !== lastApplied) {
        lastRevision = state.queueRevision;
        lastApplied = applied;
        repress(state.queue);
      }
      deck.style.setProperty("--tilt", `${options.tilt}deg`);
      if (bands.length === 0) return;

      currentIndex = state.currentIndex;
      const art = state.queue[state.currentIndex]?.artUrl ?? null;
      if (art !== lastArt) {
        lastArt = art;
        label.style.backgroundImage = art ? `url("${art}")` : "";
      }

      // Not while dragging — the hand owns the arm until it lets go.
      if (!dragging) {
        const idx = Math.max(0, Math.min(bands.length - 1, state.currentIndex));
        const r = positionToRadius(bands, idx, state.positionSecs, geo);
        arm.style.setProperty("--deg", `${armAngleDeg(r, geo, mountPoint).toFixed(2)}deg`);
      }
      // The cue lever lifts the arm on pause; the platter never stops.
      deck.classList.toggle("lifted", !state.playing);

      // A real platter turns whether or not it's playing. The app's global
      // reduced-motion CSS guard can't cross a shadow boundary, and could never
      // reach a JS-driven rotation, so honour the flag here.
      if (!host.reducedMotion) {
        spin.style.transform = `rotate(${((state.timeMs / 1800) * 360) % 360}deg)`;
      }
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
