// Tests the SHIPPED visualizer against a fake host.
//
// This started life as a conformance harness with its own throwaway deck, which
// only proved the contract was expressible. Now that the deck really is a plugin
// it drives `createVinylDeckVisualizer` itself, so it proves the contract *and*
// the implementation.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  PluginVisualizerHost,
  PluginVisualizerSize,
  PluginVisualizerState,
  PluginVisualizerTrack,
} from "../types/viboplr-visualizer";
import { createVinylDeckVisualizer, RATE_45 } from "./visualizer";
import { armAngleDeg, buildArmMount, buildGeometry, layoutBands, positionToRadius } from "./geometry";
import { SKINS } from "./skins";
import { PITCH_RANGE, composeRate } from "./pitch";
import { type Side, splitSides } from "./sides";

const SIZE = 368;
// Deliberately uneven, and deliberately UNDER one side's 22 minutes (1271s):
// everything in this file except the sides block is about a single pressing, and
// a fixture that split would quietly be testing the wrong record. Track 4 is
// kept above 300s so the seek-inside-the-playing-band test still has room.
const DURATIONS = [73, 261, 122, 87, 314, 146, 59, 209];
const QUEUE: PluginVisualizerTrack[] = DURATIONS.map((d, i) => ({
  title: `Track ${i + 1}`,
  artistName: "Halcyon Drift",
  albumTitle: "Sidereal",
  durationSecs: d,
  artUrl: null,
}));

/** Mirror of the geometry the deck will build, for computing where to click. */
const geo = buildGeometry(SIZE);
const bands = layoutBands(DURATIONS, geo);

function makeHost(over: Partial<PluginVisualizerHost> = {}) {
  const el = document.createElement("div");
  document.body.append(el);
  const root = el.attachShadow({ mode: "open" });
  const resizeHandlers: ((s: PluginVisualizerSize) => void)[] = [];
  const skinHandlers: (() => void)[] = [];
  const seek = vi.fn();
  const playQueueIndex = vi.fn();
  const setPlaying = vi.fn();
  const setRate = vi.fn();
  const token = vi.fn(() => "#6ea8ff");

  const host: PluginVisualizerHost = {
    root,
    size: { width: SIZE, height: SIZE },
    pixelRatio: 2,
    placement: "nowplaying",
    reducedMotion: false,
    token,
    useDesignSystem: vi.fn(),
    onResize: (h) => {
      resizeHandlers.push(h);
      return () => {
        const i = resizeHandlers.indexOf(h);
        if (i >= 0) resizeHandlers.splice(i, 1);
      };
    },
    onSkinChange: (h) => {
      skinHandlers.push(h);
      return () => {
        const i = skinHandlers.indexOf(h);
        if (i >= 0) skinHandlers.splice(i, 1);
      };
    },
    actions: { seek, playQueueIndex, setPlaying, setRate },
    ...over,
  };
  return { host, root, seek, playQueueIndex, setPlaying, setRate, token, resizeHandlers, skinHandlers };
}

function makeState(over: Partial<PluginVisualizerState> = {}): PluginVisualizerState {
  return {
    playing: true,
    stopped: false,
    positionSecs: 0,
    durationSecs: DURATIONS[0],
    queue: QUEUE,
    currentIndex: 0,
    queueRevision: 1,
    timeMs: 0,
    rate: 1,
    ...over,
  };
}

let arcCount = 0;
let strokes: string[] = [];
let texts: string[] = [];
const origRect = Element.prototype.getBoundingClientRect;

beforeEach(() => {
  arcCount = 0;
  strokes = [];
  texts = [];
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    setTransform: () => {}, clearRect: () => {}, beginPath: () => {},
    arc: () => { arcCount++; },
    stroke() { strokes.push(String((this as { strokeStyle: string }).strokeStyle)); },
    fill: () => {}, fillText: (t: string) => { texts.push(String(t)); },
    createRadialGradient: () => ({ addColorStop: () => {} }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    lineWidth: 0, strokeStyle: "", fillStyle: "", font: "", textAlign: "",
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;

  // jsdom has no layout, and the deck converts screen px to deck units from the
  // PLATTER's rect. Stub that 1:1 so a client coordinate IS a deck coordinate.
  //
  // The canvas is deliberately given a WRONG rect here — the axis-aligned box of
  // a rotated square, which is what the real canvas reports because it lives
  // inside the spinning layer. Measuring the canvas instead of the platter
  // shipped as a bug that broke both cue gestures while the drawing still looked
  // perfect, and this stub is what keeps it from coming back.
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this instanceof HTMLCanvasElement) {
      const spun = SIZE * Math.SQRT2; // as if mid-rotation
      return { x: 0, y: 0, left: -SIZE * 0.2, top: -SIZE * 0.2, width: spun, height: spun,
        right: spun, bottom: spun, toJSON: () => ({}) } as DOMRect;
    }
    if ((this as HTMLElement).classList?.contains("platter")) {
      // Honour the size repress() actually laid the platter out at. The SL-1200
      // livery shrinks the disc to make room for its plinth, and a stub pinned to
      // SIZE would scale every computed radius by that ratio — which would look
      // like a cue bug in a skin whose maths is in fact fine.
      const w = parseFloat((this as HTMLElement).style.width) || SIZE;
      return { x: 0, y: 0, left: 0, top: 0, width: w, height: w,
        right: w, bottom: w, toJSON: () => ({}) } as DOMRect;
    }
    return origRect.call(this);
  };
});

afterEach(() => {
  Element.prototype.getBoundingClientRect = origRect;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/**
 * Drag the headshell onto the groove `secs` into track `index`, then release.
 *
 * The head is the only handle — the record is inert — and a press alone resolves
 * nothing, so this has to be a real drag: the move is what picks the groove.
 */
function cue(
  root: ShadowRoot,
  index: number,
  secs: number,
  g: typeof geo = geo,
  b: typeof bands = bands,
) {
  const head = root.querySelector(".head") as HTMLElement;
  const r = positionToRadius(b, index, secs, g);
  const at = (x: number) => ({ bubbles: true, button: 0, pointerId: 1, clientX: x, clientY: g.cy });
  head.dispatchEvent(new MouseEvent("pointerdown", at(g.cx - g.rLeadIn)) as unknown as PointerEvent);
  head.dispatchEvent(new MouseEvent("pointermove", at(g.cx - r)) as unknown as PointerEvent);
  head.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }) as unknown as PointerEvent);
}

/**
 * The SL-1200's own geometry: the same record, laid out smaller (see skins.ts).
 *
 * Derived from the skin config rather than a copied number — the scale is a
 * tuning value that has already moved once, and a duplicate would turn every
 * future nudge into a false test failure.
 */
const SL_SCALE = SKINS.sl1200.platterScale;
const geoSL = buildGeometry(SIZE * SL_SCALE);
const bandsSL = layoutBands(DURATIONS, geoSL);
const mountSL = buildArmMount(geoSL, SKINS.sl1200.arm);

/**
 * Where the arm should come to rest on the SL-1200: straight down the ray from
 * the pivot to the post the livery draws.
 *
 * Derived from `restAt` rather than pinned to a number, for the same reason the
 * side boundaries are — the post is a tuning value, and a hardcoded angle would
 * turn every nudge of it into a false failure while hiding the one thing worth
 * asserting, which is that the two still agree.
 */
function restAngleSL() {
  const cfg = SKINS.sl1200;
  const plinthH = SIZE / cfg.aspect;
  const rx = cfg.restAt!.x * SIZE - ((SIZE - geoSL.size) / 2 + cfg.offsetX * SIZE);
  const ry = cfg.restAt!.y * plinthH - ((plinthH - geoSL.size) / 2 + cfg.offsetY * plinthH);
  return (Math.atan2(ry - mountSL.py, rx - mountSL.px) * 180) / Math.PI;
}

describe("vinyl deck visualizer", () => {
  it("builds its DOM inside the shadow root", () => {
    const { host, root } = makeHost();
    const v = createVinylDeckVisualizer();
    v.mount(host);
    expect(root.querySelector("canvas")).toBeTruthy();
    expect(root.querySelector(".arm")).toBeTruthy();
    expect(root.querySelector(".label")).toBeTruthy();
  });

  it("takes its document from the shadow root, not an ambient global", () => {
    // The plugin sandbox passes `document: undefined`, so a visualizer reaching
    // for an ambient document would throw at mount. Proven by mounting with the
    // global shadowed.
    const { host, root } = makeHost();
    const v = createVinylDeckVisualizer();
    const realDoc = globalThis.document;
    try {
      // @ts-expect-error deliberately simulating the sandbox
      globalThis.document = undefined;
      expect(() => v.mount(host)).not.toThrow();
    } finally {
      globalThis.document = realDoc;
    }
    expect(root.querySelector("canvas")).toBeTruthy();
  });

  it("presses the record once per queue change, not once per frame", () => {
    const { host } = makeHost();
    const v = createVinylDeckVisualizer();
    v.mount(host);

    v.frame(makeState());
    const afterFirst = arcCount;
    expect(afterFirst).toBeGreaterThan(50); // a real pressing, not a stub

    for (let i = 1; i < 30; i++) v.frame(makeState({ positionSecs: i, timeMs: i * 16 }));
    expect(arcCount).toBe(afterFirst); // 30 frames, one repaint

    v.frame(makeState({ queueRevision: 2 }));
    expect(arcCount).toBeGreaterThan(afterFirst);
  });

  it("takes no options, so nothing but the host can change how it draws", () => {
    // The deck used to accept a live options object (crop, tilt, gap outline) that
    // the plugin mutated behind its back, which meant frame() had to diff the
    // settings as well as the queue. Constructing it with no argument is the whole
    // contract now — and a stray argument must not resurrect a hidden knob.
    expect(createVinylDeckVisualizer.length).toBe(0);

    const { host, root } = makeHost();
    const v = createVinylDeckVisualizer();
    v.mount(host);
    v.frame(makeState());
    // The DOM those options drove is gone with them.
    expect(root.querySelector(".gaps")).toBeNull();
    expect(root.querySelector(".gap-ring")).toBeNull();
    expect((root.querySelector(".deck") as HTMLElement).classList.contains("mirror-arm")).toBe(false);
    // No tilt, and no crop transform on the platter.
    expect((root.querySelector(".deck") as HTMLElement).style.getPropertyValue("--tilt")).toBe("");
    expect((root.querySelector(".platter") as HTMLElement).style.transform).toBe("");
  });

  it("tracks the tonearm inwards as position advances", () => {
    const { host, root } = makeHost();
    const v = createVinylDeckVisualizer();
    v.mount(host);
    const arm = root.querySelector(".arm") as HTMLElement;

    v.frame(makeState({ currentIndex: 0, positionSecs: 0 }));
    const start = parseFloat(arm.style.getPropertyValue("--deg"));
    v.frame(makeState({ currentIndex: 5, positionSecs: 100 }));
    expect(parseFloat(arm.style.getPropertyValue("--deg"))).toBeGreaterThan(start);
  });

  it("lifts the arm when paused and keeps the platter turning", () => {
    const { host, root } = makeHost();
    const v = createVinylDeckVisualizer();
    v.mount(host);
    const deck = root.querySelector(".deck") as HTMLElement;
    const spin = root.querySelector(".spin") as HTMLElement;

    v.frame(makeState({ playing: true, timeMs: 0 }));
    expect(deck.classList.contains("lifted")).toBe(false);
    const a = spin.style.transform;

    v.frame(makeState({ playing: false, timeMs: 900 }));
    expect(deck.classList.contains("lifted")).toBe(true);
    expect(spin.style.transform).not.toBe(a); // still turning while paused
  });

  it("asks for the opposite of the state it was last shown when the lever is clicked", () => {
    // The lever states what it wants rather than toggling, because the host
    // compares against live state — see PluginVisualizerActions.setPlaying.
    const { host, root, setPlaying } = makeHost();
    const v = createVinylDeckVisualizer();
    v.mount(host);
    const lever = root.querySelector(".lever") as HTMLElement;

    v.frame(makeState({ playing: true }));
    lever.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(setPlaying).toHaveBeenLastCalledWith(false);

    v.frame(makeState({ playing: false }));
    lever.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(setPlaying).toHaveBeenLastCalledWith(true);
  });

  it("knows the transport state even with an empty queue, which bails early", () => {
    // frame() returns before most of its work when there are no bands; the
    // lever still has to know what to ask for.
    const { host, root, setPlaying } = makeHost();
    const v = createVinylDeckVisualizer();
    v.mount(host);
    v.frame(makeState({ playing: true, queue: [], currentIndex: -1, queueRevision: 9 }));
    (root.querySelector(".lever") as HTMLElement).dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    expect(setPlaying).toHaveBeenLastCalledWith(false);
  });

  it("degrades to a decorative lever on a host without setPlaying", () => {
    // An older host predates the action; a click must no-op, not throw.
    const { host, root } = makeHost();
    (host.actions as { setPlaying?: unknown }).setPlaying = undefined;
    const v = createVinylDeckVisualizer();
    v.mount(host);
    v.frame(makeState({ playing: true }));
    expect(() =>
      (root.querySelector(".lever") as HTMLElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      ),
    ).not.toThrow();
  });

  it("puts the cue lever in the corner clear of the disc", () => {
    // The corner is the roomiest part of a square holding an inscribed circle,
    // and the one the arm never visits.
    const { host, root } = makeHost();
    const v = createVinylDeckVisualizer();
    v.mount(host);
    v.frame(makeState());
    const lever = root.querySelector(".lever") as HTMLElement;
    const left = parseFloat(lever.style.left);
    const top = parseFloat(lever.style.top);

    // Bottom-right quadrant, and outside the record.
    expect(left).toBeGreaterThan(geo.cx);
    expect(top).toBeGreaterThan(geo.cy);
    expect(Math.hypot(left - geo.cx, top - geo.cy)).toBeGreaterThan(geo.rEdge);
    // Still inside the deck box, which is what `.deck { overflow: hidden }` clips.
    expect(left).toBeLessThan(geo.size);
    expect(top).toBeLessThan(geo.size);
  });

  it("has no groove-scrub layer — the record is not a control", () => {
    const { host, root } = makeHost();
    const v = createVinylDeckVisualizer();
    v.mount(host);
    expect(root.querySelector(".scrub")).toBeNull();
  });

  it("ignores a drag on the disc itself, however deliberate", () => {
    // The whole surface used to cue. Dragging across the platter, the label and
    // the painted grooves must now do nothing at all — the head is the handle.
    const { host, root, seek, playQueueIndex } = makeHost();
    const v = createVinylDeckVisualizer();
    v.mount(host);
    v.frame(makeState({ currentIndex: 0 }));

    const r = positionToRadius(bands, 2, 5, geo);
    const press = { bubbles: true, button: 0, pointerId: 1, clientX: geo.cx - r, clientY: geo.cy };

    for (const sel of [".platter", ".label", "canvas", ".sheen", ".body"]) {
      const part = root.querySelector(sel) as HTMLElement;
      part.dispatchEvent(new MouseEvent("pointerdown", press) as unknown as PointerEvent);
      part.dispatchEvent(new MouseEvent("pointermove", press) as unknown as PointerEvent);
      part.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }) as unknown as PointerEvent);
    }
    expect(seek).not.toHaveBeenCalled();
    expect(playQueueIndex).not.toHaveBeenCalled();
  });

  it("drags from the headshell only — the tube and counterweight are not handles", () => {
    // The listener lives on .head. A press on the tube bubbles up through .arm,
    // so if a handler were still bound there this would start a drag.
    const { host, root, seek, playQueueIndex } = makeHost();
    const v = createVinylDeckVisualizer();
    v.mount(host);
    v.frame(makeState({ currentIndex: 0 }));

    const r = positionToRadius(bands, 2, 5, geo);
    const press = { bubbles: true, button: 0, pointerId: 1, clientX: geo.cx - r, clientY: geo.cy };

    for (const sel of [".tube", ".counter", ".pivot"]) {
      const part = root.querySelector(sel) as HTMLElement;
      part.dispatchEvent(new MouseEvent("pointerdown", press) as unknown as PointerEvent);
      part.dispatchEvent(new MouseEvent("pointermove", press) as unknown as PointerEvent);
      part.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }) as unknown as PointerEvent);
    }
    expect(seek).not.toHaveBeenCalled();
    expect(playQueueIndex).not.toHaveBeenCalled();

    const head = root.querySelector(".head") as HTMLElement;
    head.dispatchEvent(new MouseEvent("pointerdown", press) as unknown as PointerEvent);
    head.dispatchEvent(new MouseEvent("pointermove", press) as unknown as PointerEvent);
    head.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }) as unknown as PointerEvent);
    expect(playQueueIndex).toHaveBeenCalledWith(2);
  });

  it("honours reduced motion, which no CSS guard can reach in a shadow root", () => {
    const { host, root } = makeHost({ reducedMotion: true });
    const v = createVinylDeckVisualizer();
    v.mount(host);
    const spin = root.querySelector(".spin") as HTMLElement;
    v.frame(makeState({ timeMs: 500 }));
    expect(spin.style.transform).toBe("");
  });

  it("plays another queue entry when cued onto a different band", () => {
    const { host, root, playQueueIndex, seek } = makeHost();
    const v = createVinylDeckVisualizer();
    v.mount(host);
    v.frame(makeState({ currentIndex: 0 }));

    cue(root, 4, 240);
    expect(playQueueIndex).toHaveBeenCalledWith(4);
    expect(seek).not.toHaveBeenCalled();
  });

  it("seeks when cued inside the band already playing", () => {
    const { host, root, playQueueIndex, seek } = makeHost();
    const v = createVinylDeckVisualizer();
    v.mount(host);
    v.frame(makeState({ currentIndex: 4, positionSecs: 10 }));

    cue(root, 4, 300);
    expect(seek).toHaveBeenCalledTimes(1);
    expect(seek.mock.calls[0][0]).toBeCloseTo(300, 0);
    expect(playQueueIndex).not.toHaveBeenCalled();
  });

  it("does nothing on a press that never moves", () => {
    // The press point on the headshell says nothing about a groove, so a click
    // must not jump to wherever the arm happened to be.
    const { host, root, playQueueIndex, seek } = makeHost();
    const v = createVinylDeckVisualizer();
    v.mount(host);
    v.frame(makeState());

    const head = root.querySelector(".head") as HTMLElement;
    head.dispatchEvent(
      new MouseEvent("pointerdown", {
        bubbles: true, button: 0, clientX: geo.cx, clientY: geo.cy,
      }) as unknown as PointerEvent,
    );
    head.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }) as unknown as PointerEvent);
    expect(playQueueIndex).not.toHaveBeenCalled();
    expect(seek).not.toHaveBeenCalled();
  });

  it("clamps a drag dragged onto the label rather than dropping it", () => {
    // Different from a press on the disc, which is inert: once you have hold of
    // the arm every position has to resolve to some groove, or the arm would
    // stick wherever you crossed the lead-in.
    const { host, root, playQueueIndex, seek } = makeHost();
    const v = createVinylDeckVisualizer();
    v.mount(host);
    v.frame(makeState({ currentIndex: 0 }));

    const head = root.querySelector(".head") as HTMLElement;
    const at = (x: number) => ({ bubbles: true, button: 0, pointerId: 1, clientX: x, clientY: geo.cy });
    head.dispatchEvent(new MouseEvent("pointerdown", at(geo.cx - geo.rLeadIn)) as unknown as PointerEvent);
    head.dispatchEvent(new MouseEvent("pointermove", at(geo.cx)) as unknown as PointerEvent); // dead centre
    head.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }) as unknown as PointerEvent);
    // Clamped to the innermost groove — the last band, not ignored and not track 1.
    expect(playQueueIndex).toHaveBeenCalledWith(DURATIONS.length - 1);
    expect(seek).not.toHaveBeenCalled();
  });

  it("ignores non-primary buttons", () => {
    const { host, root, playQueueIndex } = makeHost();
    const v = createVinylDeckVisualizer();
    v.mount(host);
    v.frame(makeState());

    const head = root.querySelector(".head") as HTMLElement;
    const r = positionToRadius(bands, 2, 60, geo);
    const at = { bubbles: true, button: 2, pointerId: 1, clientX: geo.cx - r, clientY: geo.cy };
    head.dispatchEvent(new MouseEvent("pointerdown", at) as unknown as PointerEvent);
    head.dispatchEvent(new MouseEvent("pointermove", at) as unknown as PointerEvent);
    head.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }) as unknown as PointerEvent);
    expect(playQueueIndex).not.toHaveBeenCalled();
  });

  it("follows the pointer during the drag, not only on release", () => {
    // frame() writes the arm angle from the host's position every tick. If it
    // isn't suppressed while dragging it overwrites the drag on the next frame
    // and the head appears frozen until the mouse comes up.
    const { host, root } = makeHost();
    const v = createVinylDeckVisualizer();
    v.mount(host);
    v.frame(makeState({ currentIndex: 0, positionSecs: 0 }));

    const arm = root.querySelector(".arm") as HTMLElement;
    const head = root.querySelector(".head") as HTMLElement;
    const before = arm.style.getPropertyValue("--deg");

    const inner = positionToRadius(bands, DURATIONS.length - 1, 0, geo);
    const at = (x: number) => ({ bubbles: true, button: 0, pointerId: 1, clientX: x, clientY: geo.cy });
    head.dispatchEvent(new MouseEvent("pointerdown", at(geo.cx - geo.rLeadIn)) as unknown as PointerEvent);
    head.dispatchEvent(new MouseEvent("pointermove", at(geo.cx - inner)) as unknown as PointerEvent);
    const during = arm.style.getPropertyValue("--deg");
    expect(during).not.toBe(before);

    // A frame mid-drag must not drag it back to where the host still thinks it is.
    v.frame(makeState({ currentIndex: 0, positionSecs: 0 }));
    expect(arm.style.getPropertyValue("--deg")).toBe(during);

    head.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }) as unknown as PointerEvent);
    // Released: the host owns the angle again.
    v.frame(makeState({ currentIndex: 0, positionSecs: 0 }));
    expect(arm.style.getPropertyValue("--deg")).toBe(before);
  });

  it("survives an empty queue and unknown durations", () => {
    const { host } = makeHost();
    const v = createVinylDeckVisualizer();
    v.mount(host);
    expect(() => v.frame(makeState({ queue: [], currentIndex: -1, queueRevision: 7 }))).not.toThrow();

    const unknown: PluginVisualizerTrack[] = [
      { title: "A", artistName: null, albumTitle: null, durationSecs: null, artUrl: null },
      { title: "B", artistName: null, albumTitle: null, durationSecs: null, artUrl: null },
    ];
    expect(() =>
      v.frame(makeState({ queue: unknown, currentIndex: 0, queueRevision: 8 })),
    ).not.toThrow();
  });

  it("survives a currentIndex past the end of the pressing", () => {
    const { host, root } = makeHost();
    const v = createVinylDeckVisualizer();
    v.mount(host);
    v.frame(makeState({ currentIndex: 99 }));
    const deg = (root.querySelector(".arm") as HTMLElement).style.getPropertyValue("--deg");
    expect(Number.isFinite(parseFloat(deg))).toBe(true);
  });

  it("re-presses at the new size when the slot resizes", () => {
    const { host, resizeHandlers } = makeHost();
    const v = createVinylDeckVisualizer();
    v.mount(host);
    v.frame(makeState());
    const before = arcCount;

    resizeHandlers.forEach((h) => h({ width: 200, height: 200 }));
    v.frame(makeState());
    expect(arcCount).toBeGreaterThan(before);
  });

  it("releases its subscriptions on destroy", () => {
    const { host, resizeHandlers, skinHandlers } = makeHost();
    const v = createVinylDeckVisualizer();
    v.mount(host);
    expect(resizeHandlers.length).toBe(1);
    expect(skinHandlers.length).toBe(1);
    v.destroy();
    expect(resizeHandlers.length).toBe(0);
    expect(skinHandlers.length).toBe(0);
  });

  it("grooves each band from its OWN track's waveform", () => {
    // The point of the feature: a track's audio changes how its region of the
    // record is drawn. A loud passage must not paint the same as a quiet one.
    // A ramp, so a working implementation yields many distinct groove alphas.
    const ramp = Array.from({ length: 200 }, (_, i) => 0.05 + (i / 199) * 0.95);
    const withPeaks: PluginVisualizerTrack[] = [
      { ...QUEUE[0], durationSecs: 200, peaks: ramp },
    ];

    const { host } = makeHost();
    const v = createVinylDeckVisualizer();
    v.mount(host);
    v.frame(makeState({ queue: withPeaks, currentIndex: 0, queueRevision: 41 }));

    const whites = () => new Set(strokes.filter((c) => c.startsWith("rgba(255,255,255,"))).size;
    const textured = whites();

    // The rim, lead-in, land edges and run-out are also white strokes, and are
    // IDENTICAL in both runs — so only the difference between the two is evidence
    // about the grooves. An absolute threshold here would pass with no waveform
    // effect at all.
    strokes = [];
    const noPeaks: PluginVisualizerTrack[] = [{ ...QUEUE[0], durationSecs: 200 }];
    v.frame(makeState({ queue: noPeaks, currentIndex: 0, queueRevision: 42 }));
    const flat = whites();

    expect(textured).toBeGreaterThan(flat + 20);
  });

  it("tolerates peaks arriving later, on a bumped revision", () => {
    // The host reads the waveform cache asynchronously, so a band is drawn plain
    // first and re-pressed once its peaks land.
    const { host } = makeHost();
    const v = createVinylDeckVisualizer();
    v.mount(host);

    const plain: PluginVisualizerTrack[] = [{ ...QUEUE[0], durationSecs: 120 }];
    v.frame(makeState({ queue: plain, currentIndex: 0, queueRevision: 7 }));
    const before = new Set(strokes.filter((c) => c.startsWith("rgba(255,255,255,"))).size;

    strokes = [];
    const enriched: PluginVisualizerTrack[] = [
      {
        ...QUEUE[0],
        durationSecs: 120,
        peaks: Array.from({ length: 120 }, (_, i) => 0.05 + (i / 119) * 0.95),
      },
    ];
    v.frame(makeState({ queue: enriched, currentIndex: 0, queueRevision: 8 }));
    const after = new Set(strokes.filter((c) => c.startsWith("rgba(255,255,255,"))).size;
    expect(after).toBeGreaterThan(before + 10);
  });

  it("reads no skin token, so it cannot break a skin", () => {
    // The surface is painted in alpha only and every colour comes from CSS
    // inheriting through the shadow boundary. Structural skin-safety is gone
    // from the contract, but this deck keeps it by construction.
    const { host, token } = makeHost();
    const v = createVinylDeckVisualizer();
    v.mount(host);
    v.frame(makeState());
    expect(token).not.toHaveBeenCalled();
  });
});

describe("deck liveries", () => {
  it("marks the deck with its skin so the CSS can select the livery", () => {
    const plain = makeHost();
    createVinylDeckVisualizer("studio").mount(plain.host);
    expect((plain.root.querySelector(".deck") as HTMLElement).classList.contains("skin-studio")).toBe(true);

    const silver = makeHost();
    createVinylDeckVisualizer("sl1200").mount(silver.host);
    expect((silver.root.querySelector(".deck") as HTMLElement).classList.contains("skin-sl1200")).toBe(true);
  });

  it("falls back to the plain deck for an unknown skin instead of rendering nothing", () => {
    // The skin comes from this plugin's own registration today, but a typo must
    // not produce an empty view.
    const { host, root } = makeHost();
    createVinylDeckVisualizer("nonsense" as never).mount(host);
    expect(root.querySelector("canvas")).toBeTruthy();
    expect(root.querySelector(".plinth")).toBeNull();
  });

  it("builds the plinth and its furniture only for the livery that has one", () => {
    const plain = makeHost();
    createVinylDeckVisualizer("studio").mount(plain.host);
    // Absent, not hidden — the bare deck's tree is exactly what it always was.
    for (const sel of [".plinth", ".rim", ".start", ".pitch", ".sarm"]) {
      expect(plain.root.querySelector(sel)).toBeNull();
    }

    const silver = makeHost();
    createVinylDeckVisualizer("sl1200").mount(silver.host);
    for (const sel of [".plinth", ".rim", ".dots", ".start", ".pitch", ".speeds", ".sarm"]) {
      expect(silver.root.querySelector(sel)).toBeTruthy();
    }
  });

  it("paints the plinth behind the platter", () => {
    // Order decides here, not z-index: both are children of .deck.
    const { host, root } = makeHost();
    createVinylDeckVisualizer("sl1200").mount(host);
    const kids = Array.from((root.querySelector(".deck") as HTMLElement).children);
    expect(kids.findIndex((el) => el.classList.contains("plinth")))
      .toBeLessThan(kids.findIndex((el) => el.classList.contains("platter")));
  });

  it("offsets the SL-1200's platter and leaves the plain deck's untransformed", () => {
    const silver = makeHost();
    const v = createVinylDeckVisualizer("sl1200");
    v.mount(silver.host);
    v.frame(makeState());
    const t = (silver.root.querySelector(".platter") as HTMLElement).style.transform;
    expect(t).toContain("translate");
    // Left of centre, as on the real deck.
    expect(parseFloat(t.replace(/[^-\d.]+/, ""))).toBeLessThan(0);

    const plain = makeHost();
    const v2 = createVinylDeckVisualizer("studio");
    v2.mount(plain.host);
    v2.frame(makeState());
    expect((plain.root.querySelector(".platter") as HTMLElement).style.transform).toBe("");
  });

  it("lays the SL-1200's record out smaller, to buy the plinth its room", () => {
    const { host, root } = makeHost();
    const v = createVinylDeckVisualizer("sl1200");
    v.mount(host);
    v.frame(makeState());
    const w = parseFloat((root.querySelector(".platter") as HTMLElement).style.width);
    expect(w).toBeCloseTo(SIZE * SL_SCALE, 0);
    expect(w).toBeLessThan(SIZE);
  });

  it("still presses a real record on the SL-1200", () => {
    // The livery changes mounting and paint, never the pressing.
    const { host } = makeHost();
    const v = createVinylDeckVisualizer("sl1200");
    v.mount(host);
    v.frame(makeState());
    expect(arcCount).toBeGreaterThan(50);
  });

  it("cues correctly on the SL-1200, whose disc is smaller and off-centre", () => {
    // THE test for this feature. A skin is allowed to move and resize the platter
    // and re-mount the arm; it is not allowed to make the deck disagree with
    // itself about where a track sits.
    const { host, root, playQueueIndex, seek } = makeHost();
    const v = createVinylDeckVisualizer("sl1200");
    v.mount(host);
    v.frame(makeState({ currentIndex: 0 }));

    cue(root, 4, 240, geoSL, bandsSL);
    expect(playQueueIndex).toHaveBeenCalledWith(4);
    expect(seek).not.toHaveBeenCalled();
  });

  it("seeks within the playing band on the SL-1200 too", () => {
    const { host, root, playQueueIndex, seek } = makeHost();
    const v = createVinylDeckVisualizer("sl1200");
    v.mount(host);
    v.frame(makeState({ currentIndex: 4, positionSecs: 10 }));

    cue(root, 4, 300, geoSL, bandsSL);
    expect(seek).toHaveBeenCalledTimes(1);
    expect(seek.mock.calls[0][0]).toBeCloseTo(300, 0);
    expect(playQueueIndex).not.toHaveBeenCalled();
  });

  it("mounts the SL-1200 arm at the real deck's proportions", () => {
    // Further out than the studio deck's compressed mount, which is what the
    // shrunken platter buys.
    const { host, root } = makeHost();
    const v = createVinylDeckVisualizer("sl1200");
    v.mount(host);
    v.frame(makeState());
    const arm = root.querySelector(".arm") as HTMLElement;
    const px = parseFloat(arm.style.left);
    const py = parseFloat(arm.style.top);
    expect(Math.hypot(px - geoSL.cx, py - geoSL.cy)).toBeCloseTo(geoSL.rEdge * 1.42, 0);
    expect(parseFloat(arm.style.width)).toBeCloseTo(geoSL.rEdge * 1.52, 0);
    // Above and right of the spindle, where an SL-1200's arm is bolted.
    expect(px).toBeGreaterThan(geoSL.cx);
    expect(py).toBeLessThan(geoSL.cy);
  });

  it("puts the SL-1200's cue lever beside the arm base, not on the diagonal", () => {
    const { host, root } = makeHost();
    const v = createVinylDeckVisualizer("sl1200");
    v.mount(host);
    v.frame(makeState());
    const lever = root.querySelector(".lever") as HTMLElement;
    // Right of the disc and around its vertical middle — a real deck has a place
    // for it, unlike a bare record where the corner is the only room.
    expect(parseFloat(lever.style.left)).toBeGreaterThan(geoSL.rEdge);
    expect(parseFloat(lever.style.top)).toBeLessThan(geoSL.cy);
  });

  it("drives transport from START/STOP, stating the value like the lever does", () => {
    const { host, root, setPlaying } = makeHost();
    const v = createVinylDeckVisualizer("sl1200");
    v.mount(host);
    const start = root.querySelector(".start") as HTMLElement;

    v.frame(makeState({ playing: true }));
    start.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(setPlaying).toHaveBeenLastCalledWith(false);

    v.frame(makeState({ playing: false }));
    start.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(setPlaying).toHaveBeenLastCalledWith(true);
  });

  it("leaves START/STOP inert rather than throwing on a host without setPlaying", () => {
    const { host, root } = makeHost();
    (host.actions as { setPlaying?: unknown }).setPlaying = undefined;
    const v = createVinylDeckVisualizer("sl1200");
    v.mount(host);
    v.frame(makeState({ playing: true }));
    expect(() =>
      (root.querySelector(".start") as HTMLElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      ),
    ).not.toThrow();
  });

  it("keeps the plinth pointer-transparent apart from START/STOP", () => {
    // The furniture sits over the deck; if it swallowed presses the headshell
    // would become unreachable, which is the bug the arm assembly already had.
    const { host, root } = makeHost();
    const v = createVinylDeckVisualizer("sl1200");
    v.mount(host);
    v.frame(makeState({ currentIndex: 0 }));

    const css = (root.querySelector("style") as HTMLStyleElement).textContent ?? "";
    expect(css).toMatch(/\.skin-sl1200 \.plinth\s*\{[^}]*pointer-events:\s*none/);
    expect(css).toMatch(/\.skin-sl1200 \.start\s*\{[^}]*pointer-events:\s*auto/);
  });

  it("keeps the arm out of 3D, because a projection moves the stylus", () => {
    // Asserted on the sheet because jsdom has no layout to measure it in, and it
    // is worth a brittle test: a lift drawn as translateZ under a perspective
    // scales the arm about the DECK's centre, which walks the drawn contact point
    // outward along the very radius that encodes the playing position. Measured at
    // +1.7% of the record radius on a 320px deck and +5.8% on a 1000px one (the Z
    // rose with the deck while the perspective stayed a fixed 620px), which put
    // the needle past the rim whenever the deck was stopped or paused. Height is
    // carried by brightness and the shadow instead — see .armlift.
    const { host, root } = makeHost();
    createVinylDeckVisualizer("sl1200").mount(host);
    const css = (root.querySelector("style") as HTMLStyleElement).textContent ?? "";
    expect(css).not.toMatch(/perspective\s*:/);
    expect(css).not.toMatch(/transform-style\s*:/);
    expect(css).not.toMatch(/translateZ\s*\(/);
  });

  it("reads no skin token on either livery", () => {
    // The SL-1200 names its own colours in CSS; it must still not ASK the host for
    // any, or a skin change would demand a repaint it doesn't do.
    const { host, token } = makeHost();
    const v = createVinylDeckVisualizer("sl1200");
    v.mount(host);
    v.frame(makeState());
    expect(token).not.toHaveBeenCalled();
  });
});

describe("speed selector", () => {
  const deg = (el: Element | null) =>
    parseFloat((((el as HTMLElement)?.style.transform ?? "").match(/-?[\d.]+/) ?? ["0"])[0]);

  it("asks the host for the rate the button names, as a state", () => {
    const { host, root, setRate } = makeHost();
    const v = createVinylDeckVisualizer("sl1200");
    v.mount(host);
    v.frame(makeState());

    (root.querySelector(".s45") as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // 45 / 33⅓ — "play this record at the other speed", not an abstract multiplier.
    expect(setRate).toHaveBeenLastCalledWith(RATE_45);

    (root.querySelector(".s33") as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(setRate).toHaveBeenLastCalledWith(1);
  });

  it("lights the button matching the HOST's rate, not its own clicks", () => {
    // The user can change speed in Settings, so a button tracking only its own
    // presses would drift out of step with what is actually playing.
    const { host, root } = makeHost();
    const v = createVinylDeckVisualizer("sl1200");
    v.mount(host);
    const s33 = () => root.querySelector(".s33") as HTMLElement;
    const s45 = () => root.querySelector(".s45") as HTMLElement;

    v.frame(makeState({ rate: 1 }));
    expect(s33().classList.contains("on")).toBe(true);
    expect(s45().classList.contains("on")).toBe(false);

    // Never clicked — the host just reports a different rate.
    v.frame(makeState({ rate: RATE_45 }));
    expect(s33().classList.contains("on")).toBe(false);
    expect(s45().classList.contains("on")).toBe(true);
  });

  it("lights BOTH for 78, exactly as the real deck shows it", () => {
    const { host, root } = makeHost();
    const v = createVinylDeckVisualizer("sl1200");
    v.mount(host);
    v.frame(makeState({ rate: 78 / (100 / 3) }));
    expect((root.querySelector(".s33") as HTMLElement).classList.contains("on")).toBe(false);
    expect((root.querySelector(".s45") as HTMLElement).classList.contains("on")).toBe(true);
  });

  it("leaves the buttons inert on a host without setRate, rather than throwing", () => {
    const { host, root } = makeHost();
    (host.actions as { setRate?: unknown }).setRate = undefined;
    const v = createVinylDeckVisualizer("sl1200");
    v.mount(host);
    v.frame(makeState());
    expect(() =>
      (root.querySelector(".s45") as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true })),
    ).not.toThrow();
  });

  it("spins the platter faster at a higher rate", () => {
    const { host, root } = makeHost();
    const v = createVinylDeckVisualizer("sl1200");
    v.mount(host);
    const spin = () => root.querySelector(".spin");

    v.frame(makeState({ timeMs: 0 }));
    v.frame(makeState({ timeMs: 100 }));
    const at33 = deg(spin());

    const fast = makeHost();
    const v2 = createVinylDeckVisualizer("sl1200");
    v2.mount(fast.host);
    v2.frame(makeState({ timeMs: 0, rate: RATE_45 }));
    v2.frame(makeState({ timeMs: 100, rate: RATE_45 }));
    expect(deg(fast.root.querySelector(".spin"))).toBeGreaterThan(at33);
  });

  it("accelerates the platter instead of teleporting it when the speed changes", () => {
    // Deriving the angle from timeMs * rate rescales the whole history, so the
    // record visibly jumps the instant the rate changes. Integrating the delta is
    // what keeps a 33 -> 45 press continuous.
    const { host, root } = makeHost();
    const v = createVinylDeckVisualizer("sl1200");
    v.mount(host);
    for (let t = 0; t <= 2000; t += 100) v.frame(makeState({ timeMs: t }));
    const before = deg(root.querySelector(".spin"));

    v.frame(makeState({ timeMs: 2016, rate: RATE_45 }));
    const after = deg(root.querySelector(".spin"));
    // One 16ms tick at 1.35x is ~4.3 degrees — a jump would be tens or hundreds.
    expect(Math.abs(after - before)).toBeLessThan(15);
  });

  it("holds the strobe dots still at 33 and drifts them off it", () => {
    // The real illusion: a mains-frequency lamp makes the dots look frozen at the
    // correct speed and crawl when it's off. Drifting by (rate - 1) reproduces it,
    // and it is the honest readout that the deck is misplaying the record.
    const { host, root } = makeHost();
    const v = createVinylDeckVisualizer("sl1200");
    v.mount(host);
    for (let t = 0; t <= 1000; t += 100) v.frame(makeState({ timeMs: t }));
    expect(deg(root.querySelector(".dots"))).toBeCloseTo(0, 6);

    const fast = makeHost();
    const v2 = createVinylDeckVisualizer("sl1200");
    v2.mount(fast.host);
    for (let t = 0; t <= 1000; t += 100) v2.frame(makeState({ timeMs: t, rate: RATE_45 }));
    expect(Math.abs(deg(fast.root.querySelector(".dots")))).toBeGreaterThan(1);
  });

  it("drifts the dots backwards below 33", () => {
    const { host, root } = makeHost();
    const v = createVinylDeckVisualizer("sl1200");
    v.mount(host);
    for (let t = 0; t <= 1000; t += 100) v.frame(makeState({ timeMs: t, rate: 0.74 }));
    expect(deg(root.querySelector(".dots"))).toBeLessThan(0);
  });

  it("treats a host that reports no rate as 33, so an older host is unchanged", () => {
    const { host, root } = makeHost();
    const v = createVinylDeckVisualizer("sl1200");
    v.mount(host);
    const stateWithoutRate = makeState();
    delete (stateWithoutRate as { rate?: number }).rate;
    for (let t = 0; t <= 500; t += 100) v.frame({ ...stateWithoutRate, timeMs: t });
    expect(deg(root.querySelector(".dots"))).toBeCloseTo(0, 6);
    expect((root.querySelector(".s33") as HTMLElement).classList.contains("on")).toBe(true);
  });

  it("does not spin or drift at all under reduced motion", () => {
    const { host, root } = makeHost({ reducedMotion: true });
    const v = createVinylDeckVisualizer("sl1200");
    v.mount(host);
    for (let t = 0; t <= 1000; t += 100) v.frame(makeState({ timeMs: t, rate: RATE_45 }));
    expect((root.querySelector(".spin") as HTMLElement).style.transform).toBe("");
    expect((root.querySelector(".dots") as HTMLElement).style.transform).toBe("");
  });
});

describe("pitch fader", () => {
  /** Drag the fader to a fraction of its slot: 0 = top (slowest), 1 = bottom. */
  function pull(root: ShadowRoot, travel: number) {
    const el = root.querySelector(".pitch") as HTMLElement;
    const at = { bubbles: true, button: 0, pointerId: 2, clientX: 0, clientY: travel * 100 };
    el.dispatchEvent(new MouseEvent("pointerdown", at) as unknown as PointerEvent);
    el.dispatchEvent(new MouseEvent("pointermove", at) as unknown as PointerEvent);
    el.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }) as unknown as PointerEvent);
  }

  // The fader measures its own box; jsdom has no layout, so give it one.
  function stubFaderBox(root: ShadowRoot) {
    const el = root.querySelector(".pitch") as HTMLElement;
    el.getBoundingClientRect = () =>
      ({ x: 0, y: 0, left: 0, top: 0, width: 10, height: 100, right: 10, bottom: 100,
         toJSON: () => ({}) }) as DOMRect;
  }

  function mounted(rate = 1) {
    const h = makeHost();
    const v = createVinylDeckVisualizer("sl1200");
    v.mount(h.host);
    v.frame(makeState({ rate }));
    stubFaderBox(h.root);
    return { ...h, v };
  }

  it("trims the current speed rather than replacing it", () => {
    const { root, setRate } = mounted(1);
    pull(root, 1); // hard to the + end
    expect(setRate).toHaveBeenLastCalledWith(composeRate(1, PITCH_RANGE));
  });

  it("trims 45 the same way, without falling back to 33", () => {
    // The basis is captured when the gesture starts, so a big pull can't slide
    // into the neighbouring speed's window mid-drag.
    const { root, setRate } = mounted(RATE_45);
    pull(root, 1);
    expect(setRate).toHaveBeenLastCalledWith(composeRate(RATE_45, PITCH_RANGE));
  });

  it("runs minus at the top of the slot and plus at the bottom", () => {
    const { root, setRate } = mounted(1);
    pull(root, 0);
    expect(setRate.mock.lastCall?.[0]).toBeLessThan(1);
    pull(root, 1);
    expect(setRate.mock.lastCall?.[0]).toBeGreaterThan(1);
  });

  it("positions the knob from the HOST's rate, not from its own drags", () => {
    // Same rule as the speed buttons: the rate can be changed in Settings, and a
    // knob tracking only its own gestures would drift out of step.
    const { root, v } = mounted(1);
    const travel = () =>
      parseFloat((root.querySelector(".pitch") as HTMLElement).style.getPropertyValue("--travel"));
    expect(travel()).toBeCloseTo(0.5, 6);

    v.frame(makeState({ rate: composeRate(1, PITCH_RANGE) }));
    expect(travel()).toBeCloseTo(1, 6);

    v.frame(makeState({ rate: composeRate(1, -PITCH_RANGE) }));
    expect(travel()).toBeCloseTo(0, 6);
  });

  it("lets the hand own the knob mid-drag, so a frame can't yank it back", () => {
    const { root, v } = mounted(1);
    const el = root.querySelector(".pitch") as HTMLElement;
    const travel = () => parseFloat(el.style.getPropertyValue("--travel"));

    const at = { bubbles: true, button: 0, pointerId: 2, clientX: 0, clientY: 90 };
    el.dispatchEvent(new MouseEvent("pointerdown", at) as unknown as PointerEvent);
    el.dispatchEvent(new MouseEvent("pointermove", at) as unknown as PointerEvent);
    const during = travel();

    // The host hasn't caught up yet — it still reports the old rate.
    v.frame(makeState({ rate: 1 }));
    expect(travel()).toBeCloseTo(during, 6);

    el.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }) as unknown as PointerEvent);
    v.frame(makeState({ rate: 1 }));
    expect(travel()).toBeCloseTo(0.5, 6); // released: the host owns it again
  });

  it("keeps the fader where it is when the speed button changes", () => {
    // A real deck's 33/45 buttons pick the basis; they don't reach over and
    // recentre the slider for you.
    const { root, setRate } = mounted(composeRate(1, 4));
    (root.querySelector(".s45") as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(setRate).toHaveBeenLastCalledWith(composeRate(RATE_45, 4));
  });

  it("resets to exactly the selected speed, keeping the 33/45 choice", () => {
    const { root, setRate } = mounted(composeRate(RATE_45, -6));
    (root.querySelector(".reset") as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(setRate).toHaveBeenLastCalledWith(RATE_45);
  });

  it("flags off-speed so the readout and RESET light up", () => {
    const { root, v } = mounted(1);
    const deck = root.querySelector(".deck") as HTMLElement;
    expect(deck.classList.contains("off-speed")).toBe(false);
    v.frame(makeState({ rate: composeRate(1, 3) }));
    expect(deck.classList.contains("off-speed")).toBe(true);
    v.frame(makeState({ rate: 1 }));
    expect(deck.classList.contains("off-speed")).toBe(false);
  });

  it("does nothing on a host without setRate", () => {
    const h = makeHost();
    (h.host.actions as { setRate?: unknown }).setRate = undefined;
    const v = createVinylDeckVisualizer("sl1200");
    v.mount(h.host);
    v.frame(makeState());
    stubFaderBox(h.root);
    expect(() => pull(h.root, 1)).not.toThrow();
  });

  it("has no fader at all on the plain deck", () => {
    const { root } = makeHost();
    createVinylDeckVisualizer("studio").mount(makeHost().host);
    const plain = makeHost();
    createVinylDeckVisualizer("studio").mount(plain.host);
    expect(plain.root.querySelector(".pitch")).toBeNull();
    expect(root).toBeTruthy();
  });
});

describe("three mechanisms, one playing flag", () => {
  // A deck has three things that each stop the sound, and they look nothing
  // alike. START/STOP brakes the platter and leaves the needle in the groove; the
  // cue lever raises the arm where it stands and leaves the platter turning; a
  // full stop sends the arm home to its rest. Wiring any two of them to the same
  // animation is what made the big labelled button read as a second, redundant
  // cue lever.
  const deg = (el: Element | null) =>
    parseFloat((((el as HTMLElement)?.style.transform ?? "").match(/-?[\d.]+/) ?? ["0"])[0]);

  function run(v: ReturnType<typeof createVinylDeckVisualizer>, from: number, to: number, playing = true) {
    for (let t = from; t <= to; t += 16) v.frame(makeState({ timeMs: t, playing }));
  }

  /** Frames reporting a host STOP, which is a different state from a pause. */
  function runStopped(v: ReturnType<typeof createVinylDeckVisualizer>, from: number, to: number) {
    for (let t = from; t <= to; t += 16) {
      v.frame(makeState({ timeMs: t, playing: false, stopped: true }));
    }
  }

  function mounted() {
    const h = makeHost();
    const v = createVinylDeckVisualizer("sl1200");
    v.mount(h.host);
    v.frame(makeState({ timeMs: 0 }));
    return { ...h, v, deck: h.root.querySelector(".deck") as HTMLElement };
  }

  const armDeg = (root: ShadowRoot) =>
    (root.querySelector(".arm") as HTMLElement).style.getPropertyValue("--deg");

  it("START/STOP drives the MOTOR ONLY — the arm does not move", () => {
    // The rule this whole state machine exists for. The button brakes the platter
    // and touches nothing else: raising and lowering the arm is the lever's job,
    // and a button that quietly did both is two controls pretending to be one.
    const { root, v, deck } = mounted();
    const playing = armDeg(root);

    (root.querySelector(".start") as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    run(v, 16, 1200, false);

    expect(deck.classList.contains("motor-off")).toBe(true);
    // Needle still in the groove, at exactly the angle it was tracking.
    expect(deck.classList.contains("lifted")).toBe(false);
    expect(armDeg(root)).toBe(playing);
  });

  it("pauses the host when the motor stops, and when the arm goes up", () => {
    // "Motor stopped OR head raised => paused" is the contract in the outbound
    // direction. Either mechanism alone is enough to silence a deck.
    const stop = mounted();
    (stop.root.querySelector(".start") as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(stop.setPlaying).toHaveBeenLastCalledWith(false);

    const lever = mounted();
    (lever.root.querySelector(".lever") as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(lever.setPlaying).toHaveBeenLastCalledWith(false);
  });

  it("does not start the music when START runs a platter with the arm up", () => {
    // The invariant read the other way. Both mechanisms have to be clear before
    // there can be sound, so the two controls can disagree without either being
    // wrong — which is exactly what the desk does.
    const { root, v, setPlaying, deck } = mounted();
    (root.querySelector(".lever") as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    run(v, 16, 400, false);

    const start = root.querySelector(".start") as HTMLElement;
    start.dispatchEvent(new MouseEvent("click", { bubbles: true })); // motor off
    start.dispatchEvent(new MouseEvent("click", { bubbles: true })); // motor on again
    expect(setPlaying).toHaveBeenLastCalledWith(false);
    // Platter running, arm still up — a cued deck, which is a real state.
    run(v, 416, 800, false);
    expect(deck.classList.contains("motor-off")).toBe(false);
    expect(deck.classList.contains("lifted")).toBe(true);

    // Lowering the lever is what finally asks for sound.
    (root.querySelector(".lever") as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(setPlaying).toHaveBeenLastCalledWith(true);
  });

  it("raises the arm when the HOST pauses, leaving the platter turning", () => {
    // Pressing pause in the now-playing bar is the cue lever, not the motor: the
    // arm lifts where it stands and the record keeps spinning under it.
    const { root, v, deck } = mounted();
    const playing = armDeg(root);
    run(v, 16, 400, false);

    expect(deck.classList.contains("lifted")).toBe(true);
    expect(deck.classList.contains("motor-off")).toBe(false);
    // Lifted in place — still over its own groove, not swung away.
    expect(armDeg(root)).toBe(playing);
    const a = deg(root.querySelector(".spin"));
    run(v, 416, 800, false);
    expect(deg(root.querySelector(".spin"))).not.toBeCloseTo(a, 3);
  });

  it("returns the arm to its rest when the HOST stops", () => {
    // The other host control, and the only thing that parks the arm. Off the
    // platter entirely, which is the picture "stopped" earns over "paused".
    const { root, v, deck } = mounted();
    const playing = parseFloat(armDeg(root));
    runStopped(v, 16, 1200);

    expect(deck.classList.contains("lifted")).toBe(true);
    expect(deck.classList.contains("motor-off")).toBe(true);
    // The angle falls as the arm swings outward, so parking has to leave the
    // pressing entirely — past even the rim, itself outside the outermost band.
    const parked = parseFloat(armDeg(root));
    expect(parked).toBeLessThan(playing);
    expect(parked).toBeLessThan(armAngleDeg(geoSL.rEdge, geoSL, mountSL));
  });

  it("parks on the post it draws, not merely near it", () => {
    // The rest's position and the park angle come from one `restAt`, so the arm
    // cannot come to rest beside the thing it is resting on. Aiming down the
    // pivot->post ray is what puts the post under the headshell.
    const { root, v } = mounted();
    runStopped(v, 16, 1200);

    const at = SKINS.sl1200.restAt!;
    const post = root.querySelector(".rest") as HTMLElement;
    expect(parseFloat(post.style.left)).toBeCloseTo(at.x * 100, 3);
    expect(parseFloat(post.style.top)).toBeCloseTo(at.y * 100, 3);

    expect(parseFloat(armDeg(root))).toBeCloseTo(restAngleSL(), 1);
  });

  it("takes the arm off the rest when the headshell is grabbed", () => {
    // Picking the arm up is picking it up. Without this the drag resolves, the
    // host is told, and the very next frame snaps the arm back to the post —
    // which reads as the gesture having done nothing.
    const { root, v, playQueueIndex } = mounted();
    runStopped(v, 16, 800);

    cue(root, 4, 240, geoSL, bandsSL);
    expect(playQueueIndex).toHaveBeenCalledWith(4);

    v.frame(makeState({ timeMs: 900, playing: false, currentIndex: 4, positionSecs: 240 }));
    expect(parseFloat(armDeg(root)))
      .toBeCloseTo(armAngleDeg(positionToRadius(bandsSL, 4, 240, geoSL), geoSL, mountSL), 1);
  });

  it("brings the arm back to the groove when playback resumes after a stop", () => {
    const { root, v } = mounted();
    const playing = armDeg(root);

    runStopped(v, 16, 800);
    expect(armDeg(root)).not.toBe(playing);

    run(v, 816, 1200, true);
    expect(armDeg(root)).toBe(playing);
  });

  it("has no park on a livery with no rest to park on", () => {
    // The plain deck draws no post, so a stop can only raise the arm — it must
    // keep tracking its groove rather than aim at furniture that isn't there.
    const h = makeHost();
    const v = createVinylDeckVisualizer("studio");
    v.mount(h.host);
    v.frame(makeState({ timeMs: 0 }));
    const before = (h.root.querySelector(".arm") as HTMLElement).style.getPropertyValue("--deg");

    expect(h.root.querySelector(".rest")).toBeNull();
    expect(SKINS.studio.restAt).toBeUndefined();

    for (let t = 16; t <= 400; t += 16) {
      v.frame(makeState({ timeMs: t, playing: false, stopped: true }));
    }
    expect((h.root.querySelector(".arm") as HTMLElement).style.getPropertyValue("--deg")).toBe(before);
    expect((h.root.querySelector(".deck") as HTMLElement).classList.contains("lifted")).toBe(true);
  });

  it("brakes the platter to a standstill", () => {
    const { root, v } = mounted();
    (root.querySelector(".start") as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    run(v, 16, 1200, false);

    const stopped = deg(root.querySelector(".spin"));
    run(v, 1216, 1600, false);
    expect(deg(root.querySelector(".spin"))).toBeCloseTo(stopped, 3);
  });

  it("keeps the platter turning for a cue-lever pause, and lifts the arm", () => {
    const { root, v, deck } = mounted();
    (root.querySelector(".lever") as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    run(v, 16, 400, false);
    const a = deg(root.querySelector(".spin"));

    expect(deck.classList.contains("lifted")).toBe(true);
    expect(deck.classList.contains("motor-off")).toBe(false);
    run(v, 416, 800, false);
    expect(deg(root.querySelector(".spin"))).not.toBeCloseTo(a, 3);
  });

  it("treats a pause from anywhere else as the cue lever, not the motor", () => {
    // Spacebar, the now-playing bar, a track ending — none of those stop a real
    // deck's platter, and the deck was never told which it was.
    const { v, deck } = mounted();
    run(v, 16, 200, false);
    expect(deck.classList.contains("lifted")).toBe(true);
    expect(deck.classList.contains("motor-off")).toBe(false);
  });

  it("spins back up when playback resumes, however it was resumed", () => {
    // The local motor flag is self-correcting: sound means the platter is turning.
    const { root, v, deck } = mounted();
    (root.querySelector(".start") as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    run(v, 16, 800, false);
    expect(deck.classList.contains("motor-off")).toBe(true);

    // Resumed from somewhere that isn't this deck.
    run(v, 816, 1600, true);
    expect(deck.classList.contains("motor-off")).toBe(false);
    const a = deg(root.querySelector(".spin"));
    run(v, 1616, 1800, true);
    expect(deg(root.querySelector(".spin"))).not.toBeCloseTo(a, 3);
  });

  it("accelerates into speed rather than snapping to it", () => {
    const { root, v } = mounted();
    (root.querySelector(".start") as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    run(v, 16, 1200, false);
    const stopped = deg(root.querySelector(".spin"));

    // One tick after restarting, the platter has barely moved — it is spinning up,
    // not already at 33.
    v.frame(makeState({ timeMs: 1216, playing: true }));
    const oneTick = Math.abs(deg(root.querySelector(".spin")) - stopped);
    expect(oneTick).toBeLessThan(2);
  });

  it("stops the strobe dots with the platter, since they are painted on it", () => {
    const { root, v } = mounted();
    (root.querySelector(".start") as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    run(v, 16, 1200, false);
    const at = deg(root.querySelector(".dots"));
    run(v, 1216, 1600, false);
    expect(deg(root.querySelector(".dots"))).toBeCloseTo(at, 3);
  });

  it("leaves the plain deck's platter running on any pause, as it always did", () => {
    // No START/STOP there, so nothing can claim the motor is off.
    const h = makeHost();
    const v = createVinylDeckVisualizer("studio");
    v.mount(h.host);
    v.frame(makeState({ timeMs: 0, playing: false }));
    v.frame(makeState({ timeMs: 400, playing: false }));
    const deck = h.root.querySelector(".deck") as HTMLElement;
    expect(deck.classList.contains("lifted")).toBe(true);
    expect(deck.classList.contains("motor-off")).toBe(false);
    expect(deg(h.root.querySelector(".spin"))).toBeGreaterThan(0);
  });
});

describe("START/STOP survives the host's acknowledgement lag", () => {
  // THE bug this file exists to prevent. setPlaying() is asynchronous from the
  // deck's point of view: the host has to re-render before `state.playing` flips,
  // and frame() keeps running at display rate in the meantime. Those in-between
  // frames still report playing=true, so a "sound means the motor is running"
  // check written against the LEVEL clears the motor flag before the pause ever
  // arrives — and the deck falls back to showing a cue-lever pause with the
  // platter still turning.
  //
  // The earlier tests jumped straight to playing=false and never saw it.
  const deg = (el: Element | null) =>
    parseFloat((((el as HTMLElement)?.style.transform ?? "").match(/-?[\d.]+/) ?? ["0"])[0]);

  function mounted() {
    const h = makeHost();
    const v = createVinylDeckVisualizer("sl1200");
    v.mount(h.host);
    v.frame(makeState({ timeMs: 0, playing: true }));
    return { ...h, v, deck: h.root.querySelector(".deck") as HTMLElement };
  }

  it("still stops the platter when the host lags a few frames behind", () => {
    const { root, v, deck } = mounted();
    (root.querySelector(".start") as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // The host hasn't caught up yet — it is still reporting playback.
    for (let t = 16; t <= 96; t += 16) v.frame(makeState({ timeMs: t, playing: true }));
    expect(deck.classList.contains("motor-off")).toBe(true);

    // Now the pause lands, and the platter must brake rather than keep turning.
    for (let t = 112; t <= 1400; t += 16) v.frame(makeState({ timeMs: t, playing: false }));
    expect(deck.classList.contains("motor-off")).toBe(true);
    // And the arm stays DOWN throughout. The pause frames that arrive after the
    // button are the deck's own doing, so the "something else paused us, raise the
    // lever" branch must not fire on them — that is the guard that keeps
    // START/STOP from collapsing back into a second cue lever.
    expect(deck.classList.contains("lifted")).toBe(false);

    const stopped = deg(root.querySelector(".spin"));
    for (let t = 1416; t <= 1800; t += 16) v.frame(makeState({ timeMs: t, playing: false }));
    expect(deg(root.querySelector(".spin"))).toBeCloseTo(stopped, 3);
  });

  it("does not raise the lever in the window after asking to play", () => {
    // The subtlest lag of the three, and the one the three-mechanism split
    // introduced. Asking for playback is followed by frames that still report
    // paused; with the motor now running and the arm down, "silent for a reason I
    // can't account for" wrongly describes them, and the deck would pop its own
    // lever up one frame after the user pressed START to lower it.
    const { root, v, deck } = mounted();
    const start = root.querySelector(".start") as HTMLElement;

    start.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    for (let t = 16; t <= 400; t += 16) v.frame(makeState({ timeMs: t, playing: false }));

    start.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // A long lag on purpose: the guard must hold until the host answers, not for
    // a couple of frames.
    for (let t = 416; t <= 1600; t += 16) v.frame(makeState({ timeMs: t, playing: false }));
    expect(deck.classList.contains("lifted")).toBe(false);

    // And it must not become permanent — a pause from elsewhere, once playback has
    // actually landed, still raises the lever.
    for (let t = 1616; t <= 1800; t += 16) v.frame(makeState({ timeMs: t, playing: true }));
    expect(deck.classList.contains("lifted")).toBe(false);
    for (let t = 1816; t <= 2000; t += 16) v.frame(makeState({ timeMs: t, playing: false }));
    expect(deck.classList.contains("lifted")).toBe(true);
    expect(deck.classList.contains("motor-off")).toBe(false);
  });

  it("still clears the motor flag when playback genuinely resumes", () => {
    // The fix must not turn the flag into something only the button can clear —
    // resuming from the spacebar has to spin the platter back up.
    const { root, v, deck } = mounted();
    (root.querySelector(".start") as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    for (let t = 16; t <= 800; t += 16) v.frame(makeState({ timeMs: t, playing: false }));
    expect(deck.classList.contains("motor-off")).toBe(true);

    // Rising edge from somewhere that isn't this deck.
    for (let t = 816; t <= 1600; t += 16) v.frame(makeState({ timeMs: t, playing: true }));
    expect(deck.classList.contains("motor-off")).toBe(false);
    const a = deg(root.querySelector(".spin"));
    for (let t = 1616; t <= 1800; t += 16) v.frame(makeState({ timeMs: t, playing: true }));
    expect(deg(root.querySelector(".spin"))).not.toBeCloseTo(a, 3);
  });

  it("restarts from the button without the arm twitching in between", () => {
    // The other lag direction. Pressing START asks the host for playback, and the
    // frames before it answers still report paused — the deck must sit still
    // through them rather than half-animate anything. The arm in particular never
    // moves at all here: neither press touches it, in either direction.
    const { root, v, deck } = mounted();
    const start = root.querySelector(".start") as HTMLElement;
    const arm = root.querySelector(".arm") as HTMLElement;
    const groove = arm.style.getPropertyValue("--deg");

    start.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    for (let t = 16; t <= 800; t += 16) v.frame(makeState({ timeMs: t, playing: false }));
    expect(deck.classList.contains("motor-off")).toBe(true);
    expect(deck.classList.contains("lifted")).toBe(false);

    // Press again. The host lags the other way now, still reporting paused.
    start.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    for (let t = 816; t <= 880; t += 16) v.frame(makeState({ timeMs: t, playing: false }));
    expect(deck.classList.contains("lifted")).toBe(false);
    // The motor is running the moment the button says so — the brake and the
    // start are both instant on a real deck, and neither waits on the host.
    expect(deck.classList.contains("motor-off")).toBe(false);

    // Sound starts. Nothing about the arm has changed across the whole sequence.
    for (let t = 896; t <= 1600; t += 16) v.frame(makeState({ timeMs: t, playing: true }));
    expect(deck.classList.contains("motor-off")).toBe(false);
    expect(deck.classList.contains("lifted")).toBe(false);
    expect(arm.style.getPropertyValue("--deg")).toBe(groove);
  });
});

describe("a queue too long for one side", () => {
  // Uneven, and long enough to need several sides.
  const LONG_DURATIONS = Array.from({ length: 30 }, (_, i) => 120 + (i % 7) * 30);
  const LONG: PluginVisualizerTrack[] = LONG_DURATIONS.map((d, i) => ({
    title: `T${i}`,
    artistName: "A",
    albumTitle: "B",
    durationSecs: d,
    artUrl: null,
  }));

  // DERIVED, never hardcoded: the boundaries follow from the durations and the
  // side length, and pinning them here would just re-assert splitSides while
  // silently breaking whenever it is retuned.
  const SIDES = splitSides(LONG_DURATIONS);

  /** Geometry and bands for one side, for aiming a cue at a known band. */
  function sideGeo(side: Side) {
    const g = buildGeometry(SIZE);
    return { g, b: layoutBands(LONG_DURATIONS.slice(side.start, side.start + side.count), g) };
  }

  const longState = (over: Partial<PluginVisualizerState> = {}) =>
    makeState({ queue: LONG, queueRevision: 50, ...over });

  function mounted(over: Partial<PluginVisualizerState> = {}) {
    const h = makeHost();
    const v = createVinylDeckVisualizer();
    v.mount(h.host);
    v.frame(longState(over));
    return { ...h, v };
  }

  it("needs more than one side for this queue", () => {
    // Guards the fixture itself: if a retune ever fits all 30 on one side, every
    // assertion below would pass for the wrong reason.
    expect(SIDES.length).toBeGreaterThan(2);
  });

  it("presses only the side holding the playing track", () => {
    // Aim at the innermost band: it must be the last track of THIS side, not the
    // last of the queue.
    const { root, playQueueIndex } = mounted({ currentIndex: 0 });
    const { g, b } = sideGeo(SIDES[0]);
    cue(root, SIDES[0].count - 1, LONG_DURATIONS[SIDES[0].count - 1], g, b);
    expect(playQueueIndex).toHaveBeenCalledWith(SIDES[0].count - 1);
    expect(SIDES[0].count).toBeLessThan(LONG.length);
  });

  it("cues to ABSOLUTE queue indices from a later side", () => {
    // The band grabbed is side-relative; the host only speaks queue indices.
    // Getting this wrong plays the right-looking band on the wrong side.
    const two = SIDES[1];
    const { root, playQueueIndex } = mounted({ currentIndex: two.start });
    const { g, b } = sideGeo(two);
    cue(root, 1, 30, g, b);
    expect(playQueueIndex).toHaveBeenCalledWith(two.start + 1);
  });

  it("seeks rather than restarts when cued onto the playing band of a later side", () => {
    const two = SIDES[1];
    const { root, playQueueIndex, seek } = mounted({ currentIndex: two.start + 2, positionSecs: 5 });
    const { g, b } = sideGeo(two);
    cue(root, 2, 40, g, b);
    expect(seek).toHaveBeenCalledTimes(1);
    expect(playQueueIndex).not.toHaveBeenCalled();
  });

  it("re-presses when playback crosses onto the next side", () => {
    const { v } = mounted({ currentIndex: SIDES[0].count - 1 });
    const afterSideOne = arcCount;
    // Same queue and same revision — only the side changed.
    v.frame(longState({ currentIndex: SIDES[1].start }));
    expect(arcCount).toBeGreaterThan(afterSideOne);
  });

  it("does NOT re-press while playing through one side", () => {
    // Sides are fixed blocks, so the record is stable until a boundary. A window
    // centred on the playing track would repaint on every advance.
    const { v } = mounted({ currentIndex: 0 });
    const afterFirst = arcCount;
    for (let i = 1; i < SIDES[0].count; i++) v.frame(longState({ currentIndex: i }));
    expect(arcCount).toBe(afterFirst);
  });

  it("etches the side into the dead wax", () => {
    mounted({ currentIndex: 0 });
    expect(texts).toContain(`SIDE 1 OF ${SIDES.length}`);

    texts = [];
    const last = SIDES[SIDES.length - 1];
    mounted({ currentIndex: last.start });
    expect(texts).toContain(`SIDE ${SIDES.length} OF ${SIDES.length}`);
  });

  it("says nothing on a queue that fits one side", () => {
    // "SIDE 1 OF 1" on a record with nowhere else to be is noise.
    const h = makeHost();
    const v = createVinylDeckVisualizer();
    v.mount(h.host);
    texts = [];
    v.frame(makeState({ currentIndex: 0 }));
    expect(texts.join(" ")).not.toMatch(/SIDE/);
  });

  it("still presses a short queue whole", () => {
    // The fixture the rest of this file uses: sides must not touch it.
    const { host, root, playQueueIndex } = makeHost();
    const v = createVinylDeckVisualizer();
    v.mount(host);
    v.frame(makeState({ currentIndex: 0 }));
    cue(root, DURATIONS.length - 1, 10);
    expect(playQueueIndex).toHaveBeenCalledWith(DURATIONS.length - 1);
  });

  it("keeps the arm within the pressing when the playing track is elsewhere", () => {
    const { root, v } = mounted({ currentIndex: 0 });
    const arm = root.querySelector(".arm") as HTMLElement;
    const atStart = parseFloat(arm.style.getPropertyValue("--deg"));

    v.frame(longState({ currentIndex: LONG.length - 1 }));
    const after = parseFloat(arm.style.getPropertyValue("--deg"));
    expect(Number.isFinite(after)).toBe(true);
    expect(after).toBeGreaterThan(atStart);
  });

  it("survives the queue shrinking under the current side", () => {
    const { v, root } = mounted({ currentIndex: LONG.length - 2 });
    expect(() =>
      v.frame(makeState({ currentIndex: LONG.length - 2, queueRevision: 51 })),
    ).not.toThrow();
    const deg = (root.querySelector(".arm") as HTMLElement).style.getPropertyValue("--deg");
    expect(Number.isFinite(parseFloat(deg))).toBe(true);
  });
});
