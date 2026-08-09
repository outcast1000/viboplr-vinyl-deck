import { describe, expect, it } from "vitest";
import {
  CLICKS,
  DEFAULT_SOUND_SETTINGS,
  TONE_GAIN,
  VOICES,
  createDeckSounds,
  crackleRate,
  rumbleParams,
  scrapeParams,
  surfaceGain,
  voiceOn,
  type DeckSoundSettings,
  type VoiceId,
} from "./sounds";

/**
 * A counting stand-in for Web Audio.
 *
 * jsdom has none, and without something here the per-voice switches would be
 * untestable — which is the one part of this module a bug would be invisible in.
 * A wrong filter frequency is audible the moment anyone listens; a checkbox
 * wired to nothing looks perfect and does nothing, and there are eleven of them.
 *
 * It counts SOURCE creations, because every one-shot here begins with one: if a
 * silenced voice creates no source, it made no sound.
 */
interface FakeNode {
  outs: FakeNode[];
  type?: string;
  gain?: { value: number };
  connect(n: FakeNode): FakeNode;
}

function fakeCtx() {
  const created: string[] = [];
  const param = () => ({
    value: 0,
    setValueAtTime() {},
    cancelScheduledValues() {},
    setTargetAtTime() {},
    exponentialRampToValueAtTime() {},
    // Ramps land immediately, so a test can read the destination off `.value`.
    linearRampToValueAtTime(v: number) {
      (this as { value: number }).value = v;
    },
  });
  const filters: FakeNode[] = [];
  const node = (extra: Record<string, unknown> = {}) => ({
    outs: [] as FakeNode[],
    connect(n: FakeNode) {
      (this as unknown as FakeNode).outs.push(n);
      return n;
    },
    disconnect() {},
    start() {},
    stop() {},
    ...extra,
  });
  return {
    created,
    filters,
    currentTime: 0,
    sampleRate: 8000,
    destination: node(),
    createBuffer: (_c: number, len: number, sr: number) => ({
      duration: len / sr,
      getChannelData: () => new Float32Array(len),
    }),
    createGain: () => node({ gain: param() }),
    createBiquadFilter: () => {
      const f = node({ type: "", frequency: param(), Q: param() }) as unknown as FakeNode;
      filters.push(f);
      return f;
    },
    createBufferSource: () => {
      created.push("source");
      return node({ buffer: null, loop: false, onended: null });
    },
    createOscillator: () => {
      created.push("osc");
      return node({ type: "", frequency: param() });
    },
  };
}

/** Sounds against the fake, with every voice on unless told otherwise. */
function mounted(over: Partial<DeckSoundSettings> = {}) {
  const ctx = fakeCtx();
  const s = createDeckSounds(ctx as unknown as AudioContext, {
    enabled: true,
    voices: Object.fromEntries(VOICES.map((v) => [v.id, true])),
    ...over,
  });
  // The beds are found by their filter type rather than by construction order,
  // so reordering the graph doesn't quietly point these tests at the wrong node.
  // Captured before the trigger filters exist, so there is no ambiguity.
  const bedGain = (type: string) => ctx.filters.find((f) => f.type === type)?.outs[0]?.gain;
  const beds = {
    rumble: bedGain("lowpass")!,
    hiss: bedGain("highpass")!,
    scrape: bedGain("bandpass")!,
  };
  // The four always-running beds are built at construction; only what happens
  // AFTER counts as a triggered sound.
  ctx.created.length = 0;
  return { ctx, s, beds };
}

/**
 * jsdom has no Web Audio, so the node graph itself is auditioned in the dev
 * harness rather than asserted here. What IS testable is everything the graph is
 * steered by — the parameter maths — plus the contract that a missing context
 * yields a working silent object. Both are where a real bug would hide: a
 * spin-down that never reaches silence, or a null context that throws on the
 * first frame and takes the visualizer down with it.
 */
describe("deck sound parameters", () => {
  it("takes the rumble to silence at rest, so a stopped deck is stopped", () => {
    const at0 = rumbleParams(0);
    expect(at0.gain).toBe(0);
    expect(at0.toneHz).toBe(0);
  });

  it("drops the motor tone's pitch in proportion to velocity", () => {
    // This IS the spin-down. Nothing else authors that sound: the deck's own
    // eased spinVel goes in and the sag comes out, so a brake interrupted
    // halfway by START needs no special case.
    const full = rumbleParams(1).toneHz;
    expect(full).toBeGreaterThan(0);
    expect(rumbleParams(0.5).toneHz).toBeCloseTo(full / 2, 5);
    expect(rumbleParams(0.25).toneHz).toBeCloseTo(full / 4, 5);
  });

  it("fades the rumble faster than linearly, so a creeping platter is inaudible", () => {
    // A linear law leaves an audible hum hanging around the last few percent of
    // the brake, which reads as the motor never quite stopping.
    expect(rumbleParams(0.1).gain).toBeLessThan(rumbleParams(1).gain * 0.1);
  });

  it("clamps a runaway velocity instead of scaling with it", () => {
    expect(rumbleParams(9).gain).toEqual(rumbleParams(2).gain);
    expect(rumbleParams(-3).gain).toBe(0);
  });

  it("silences the groove noise when the needle is up or the record still", () => {
    // The two mechanisms the deck spends most of its care keeping distinct: a
    // stylus resting on a stopped record makes no noise, and neither does a
    // lifted one over a spinning record.
    expect(surfaceGain(1, false)).toBe(0);
    expect(surfaceGain(0, true)).toBe(0);
    expect(surfaceGain(1, true)).toBeGreaterThan(0);
    expect(crackleRate(1, false)).toBe(0);
    expect(crackleRate(0, true)).toBe(0);
  });

  it("saturates the scrape rather than letting a flick run away", () => {
    // A hand can move the headshell faster than any stylus would survive.
    const fast = scrapeParams(100000);
    expect(fast.gain).toBeLessThanOrEqual(0.22);
    expect(fast.centerHz).toBeLessThanOrEqual(260 + 1400);
    expect(scrapeParams(0).gain).toBe(0);
    expect(scrapeParams(-5).gain).toBe(0);
  });

  it("keeps every click short enough to be a click", () => {
    // A "click" long enough to have a pitch is a beep, and the deck would sound
    // like a toy rather than a machine.
    for (const [kind, spec] of Object.entries(CLICKS)) {
      expect(spec.durMs, kind).toBeLessThanOrEqual(20);
      expect(spec.gain, kind).toBeGreaterThan(0);
    }
    // The one switch with a plinth behind it is the only one with a body.
    expect(CLICKS.transport.thumpHz).toBeDefined();
    expect(CLICKS.speed.thumpHz).toBeUndefined();
  });
});

describe("createDeckSounds without an audio context", () => {
  it("returns a fully-formed silent object", () => {
    // What the APP gets today: the plugin sandbox has no AudioContext, so every
    // call site must be safe unguarded. A throw here would take the whole
    // visualizer's frame loop down with it.
    const s = createDeckSounds(null);
    expect(() => {
      s.setSettings({ enabled: true, level: 1, voices: { hiss: true, crackle: true } });
      s.frame(1, true);
      s.drop();
      s.lift();
      s.click("transport");
      s.scrape(500);
      s.endScrape();
      s.destroy();
      s.destroy();
    }).not.toThrow();
  });

  it("keeps the silent object silent even when settings say otherwise", () => {
    // Turning sounds on with no context available must stay a no-op rather than
    // becoming the path that reaches for one.
    const s = createDeckSounds(null, { enabled: true, level: 1, voices: { hiss: true } });
    expect(() => s.frame(1, true)).not.toThrow();
  });
});

describe("default settings", () => {
  it("ships off, with surface noise off even when sounds are on", () => {
    // These play over the user's music, so they are opt-in; and the surface bed
    // is opt-in again on top, because it is a filter over every second of the
    // library rather than punctuation at a moment.
    expect(DEFAULT_SOUND_SETTINGS.enabled).toBe(false);
    expect(DEFAULT_SOUND_SETTINGS.voices.hiss).toBe(false);
    expect(DEFAULT_SOUND_SETTINGS.voices.crackle).toBe(false);
  });

  it("treats an unlisted voice as on, so a new noise needs no migration", () => {
    // Settings persist. A voice added after a user's settings were written
    // simply isn't mentioned in them, and must not read as silenced.
    const s: DeckSoundSettings = { enabled: true, level: 1, voices: {} };
    expect(voiceOn(s, "motor")).toBe(true);
    expect(voiceOn({ ...s, enabled: false }, "motor")).toBe(false);
  });

  it("gives every declared voice a labelled switch, exactly once", () => {
    // The harness and the settings panel both build their checkbox list from
    // VOICES, so a voice missing from it is a sound with no way to turn it off.
    const ids = VOICES.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const v of VOICES) expect(v.label.length).toBeGreaterThan(0);
    const clickKinds: VoiceId[] = ["transport", "speed", "detent", "band", "runout"];
    for (const k of clickKinds) expect(ids).toContain(k);
  });
});

describe("per-sound switches", () => {
  const triggers: { id: VoiceId; fire: (s: ReturnType<typeof mounted>["s"]) => void }[] = [
    { id: "drop", fire: (s) => s.drop() },
    { id: "lift", fire: (s) => s.lift() },
    { id: "transport", fire: (s) => s.click("transport") },
    { id: "speed", fire: (s) => s.click("speed") },
    { id: "detent", fire: (s) => s.click("detent") },
    { id: "band", fire: (s) => s.click("band") },
    { id: "runout", fire: (s) => s.click("runout") },
  ];

  for (const t of triggers) {
    it(`makes a sound for ${t.id} when its switch is on`, () => {
      const { ctx, s } = mounted();
      t.fire(s);
      expect(ctx.created.length).toBeGreaterThan(0);
    });

    it(`makes NO sound for ${t.id} when its switch is off`, () => {
      const { ctx, s } = mounted({ voices: { [t.id]: false } });
      t.fire(s);
      expect(ctx.created).toEqual([]);
    });

    it(`makes no sound for ${t.id} when the master is off`, () => {
      const { ctx, s } = mounted({ enabled: false });
      t.fire(s);
      expect(ctx.created).toEqual([]);
    });
  }

  it("silences one voice without touching the others", () => {
    // The whole point of eleven switches: they have to be independent.
    const { ctx, s } = mounted({ voices: { drop: false } });
    s.drop();
    expect(ctx.created).toEqual([]);
    s.lift();
    expect(ctx.created.length).toBeGreaterThan(0);
  });

  it("stops a running bed the moment its switch flips, not on the next frame", () => {
    // The beds are always-running sources steered by gain, so unlike the
    // one-shots they don't just fail to start — they keep humming until
    // something tells them. A checkbox with a frame of lag feels broken; one
    // that waits for a frame that never comes (paused, off-screen) IS broken.
    const { s, beds } = mounted();
    s.frame(1, true);
    expect(beds.rumble.value).toBeGreaterThan(0);
    expect(beds.hiss.value).toBeGreaterThan(0);

    s.setSettings({ voices: { motor: false, hiss: false } });
    expect(beds.rumble.value).toBe(0);
    expect(beds.hiss.value).toBe(0);

    // And a frame at full speed must not bring them back.
    s.frame(1, true);
    expect(beds.rumble.value).toBe(0);
    expect(beds.hiss.value).toBe(0);

    // Turning one back on does, without reviving the other.
    s.setSettings({ voices: { motor: true } });
    s.frame(1, true);
    expect(beds.rumble.value).toBeGreaterThan(0);
    expect(beds.hiss.value).toBe(0);
  });

  it("silences the scrape bed when its switch is off, mid-drag", () => {
    // The one bed driven by a gesture rather than by frame(): turning it off
    // while the hand is still moving has to take effect on the next move, not
    // when the drag happens to end.
    const { s, beds } = mounted();
    s.scrape(1500);
    expect(beds.scrape.value).toBeGreaterThan(0);
    s.setSettings({ voices: { scrape: false } });
    expect(beds.scrape.value).toBe(0);
    s.scrape(1500);
    expect(beds.scrape.value).toBe(0);
  });

  it("keeps the crackle silent when its switch is off but hiss is on", () => {
    // They were one "surface" toggle before and are now two, which is only
    // worth anything if they really are independent.
    const { ctx, s } = mounted({ voices: { crackle: false } });
    for (let i = 0; i < 200; i++) {
      (ctx as { currentTime: number }).currentTime += 0.05;
      s.frame(1, true);
    }
    expect(ctx.created).toEqual([]);
  });
});

describe("the motor bed", () => {
  it("stays quiet enough to sit under music", () => {
    // It runs for the entire time anything is playing, which is what separates
    // it from every other voice here.
    expect(rumbleParams(1).gain).toBeLessThan(0.08);
    expect(TONE_GAIN).toBeLessThan(rumbleParams(1).gain / 3);
  });

  it("keeps the motor tone below the register of real bass lines", () => {
    // A pitched component up in the bass beats against the music it plays over.
    expect(rumbleParams(1).toneHz).toBeLessThan(90);
  });
});
