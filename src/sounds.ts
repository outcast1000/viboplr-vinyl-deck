// The deck's noises, synthesised.
//
// NOTHING IS SAMPLED. The release zip is manifest.json + index.js (see
// scripts/package.sh), so there is nowhere to put a .wav — but the constraint
// happens to agree with the design. The two sounds that matter most are a
// platter spinning down and a stylus being dragged across a turning record, and
// both are continuous responses to a live number: the brake curve is an
// exponential ease whose duration depends on where the platter was, and a scrape
// tracks how fast the hand is moving. A fixed sample can only ever be a picture
// of one particular spin-down.
//
// THIS MODULE DOES NOT REACH FOR AN AudioContext, it is handed one. The plugin
// sandbox (usePlugins.ts) is a frozen, null-prototype object with an explicit
// allowlist — timers, console, Math, JSON, Date, Promise and the plain
// constructors — and `document` is undefined. There is no AudioContext in it and
// no way to construct one without going around the sandbox via the shadow root's
// ownerDocument, which is exactly the kind of thing that works until someone
// tightens the sandbox. So the context arrives from outside: the dev harness
// hands over a real one, and the app will hand over whatever the host eventually
// grants. Passing `null` yields a fully-formed silent object, which is what the
// app gets until that capability exists — so call sites need no guards.

/**
 * Every noise the deck can make, as its own switch.
 *
 * One toggle per sound rather than a few grouped categories, because these are
 * not variations on one effect — they are unrelated noises that happen to come
 * from the same object, and taste about them does not correlate. Someone who
 * wants the needle drop and nothing else is not an exotic case; neither is
 * someone who wants the mechanism silent and only the record surface. Grouping
 * would force those users to take a sound they came to turn off.
 */
export type VoiceId =
  | "motor"
  | "drop"
  | "lift"
  | "scrape"
  | "transport"
  | "speed"
  | "detent"
  | "band"
  | "runout"
  | "hiss"
  | "crackle";

/**
 * The switch list, in the order a settings panel should show it: the continuous
 * beds, then the needle, then the controls. Labels live here so the harness and
 * the eventual settings panel cannot disagree about what a voice is called.
 */
export const VOICES: { id: VoiceId; label: string; hint: string }[] = [
  { id: "motor", label: "Platter motor", hint: "Rumble and the spin-up / spin-down sag" },
  { id: "hiss", label: "Groove hiss", hint: "Surface noise while the needle is down" },
  { id: "crackle", label: "Crackle", hint: "Occasional pops" },
  { id: "drop", label: "Needle drop", hint: "The stylus meeting the groove" },
  { id: "lift", label: "Cue lift", hint: "The lever taking it off again" },
  { id: "scrape", label: "Cue scrape", hint: "Dragging the headshell across a turning record" },
  { id: "band", label: "Track ticks", hint: "Crossing the land between tracks" },
  { id: "runout", label: "Run-out", hint: "The tick at the end of the pressing" },
  { id: "transport", label: "START/STOP", hint: "The transport switch" },
  { id: "speed", label: "33 / 45 buttons", hint: "The speed switches" },
  { id: "detent", label: "Pitch detent", hint: "The click at 0%" },
];

/** What the user gets to decide. Persisted by the plugin, not by this module. */
export interface DeckSoundSettings {
  /** Master. Off by default: these play over the user's music. */
  enabled: boolean;
  /** 0..1, relative to whatever the host's own volume turns out to be. */
  level: number;
  /** Per-sound switches. A missing key reads as ON — see `voiceOn`. */
  voices: Partial<Record<VoiceId, boolean>>;
}

/**
 * Is this voice on?
 *
 * ABSENT MEANS ON, which is what makes adding a twelfth noise later a one-line
 * change instead of a migration: stored settings written before it existed
 * simply don't mention it. The master switch is still the gate above it, so
 * "on" here only ever means "not individually silenced".
 */
export function voiceOn(s: DeckSoundSettings, id: VoiceId): boolean {
  return s.enabled && s.voices[id] !== false;
}

export const DEFAULT_SOUND_SETTINGS: DeckSoundSettings = {
  enabled: false,
  level: 0.5,
  // The record surface starts silenced even once sounds are on. The mechanism
  // noises are punctuation — a click when you press a thing — while hiss and
  // crackle are a filter over every second of the user's library, and constant
  // surface noise under a real recording is fatiguing in a way a click is not.
  voices: { hiss: false, crackle: false },
};

/**
 * The rumble bed, as a function of platter velocity (1 = 33⅓).
 *
 * The tone's pitch is proportional to velocity and nothing else, which is the
 * whole spin-down effect: as the brake takes hold the pitch sags to nothing.
 * That is what a slowing record sounds like, and it falls out of the deck's
 * existing eased `spinVel` for free — no envelope to hand-author, and a
 * spin-down interrupted halfway by START sounds right without a special case.
 *
 * Gain rises faster than linearly so a platter creeping at 5% is inaudible
 * rather than a quiet hum that never quite stops.
 */
export function rumbleParams(vel: number): { cutoffHz: number; toneHz: number; gain: number } {
  const v = Math.max(0, Math.min(2, vel));
  return {
    // Darker than it was. The brightness in a rumble is what makes it read as
    // noise sitting ON the music rather than under it, and the platter is
    // running for the entire time anything is playing.
    cutoffHz: 35 + 80 * v,
    // Lower than it was, for the same reason and one more: at 110Hz the tone
    // was in the register of actual bass lines and it beat against them. Down
    // here it is closer to felt than heard, and it is the SAG that has to
    // register, not the steady state.
    toneHz: 74 * v,
    gain: 0.065 * v * v,
  };
}

/**
 * The motor tone's level.
 *
 * Held well under the rumble's: a pitched component is far more noticeable than
 * broadband noise at equal gain, and this one runs continuously under music the
 * user chose. Loud enough to sag audibly when the brake bites, and no louder.
 */
export const TONE_GAIN = 0.013;

/**
 * Groove hiss level. Silent unless the needle is actually in the groove AND the
 * record is turning — a stylus resting on a stopped record makes no noise, which
 * is the difference between the cue lever and START/STOP that the deck spends so
 * much effort keeping distinct.
 */
export function surfaceGain(vel: number, needleDown: boolean): number {
  if (!needleDown) return 0;
  return 0.055 * Math.max(0, Math.min(1.5, vel));
}

/**
 * Pops per second. Scaled by velocity for the same reason as the hiss, and kept
 * deliberately sparse: crackle reads as "a record" at a few per second and as a
 * fault above that.
 */
export function crackleRate(vel: number, needleDown: boolean): number {
  if (!needleDown) return 0;
  return 3.5 * Math.max(0, Math.min(1.5, vel));
}

/**
 * The cue scrape, from the drag speed in px/sec.
 *
 * Both terms saturate. A hand can flick the headshell faster than any real
 * stylus could survive, and without a ceiling the sound would keep getting
 * louder and brighter past anything a record does.
 */
export function scrapeParams(speedPxPerSec: number): { gain: number; centerHz: number } {
  const s = Math.max(0, speedPxPerSec);
  return {
    gain: Math.min(0.22, s / 4000),
    centerHz: 260 + Math.min(1400, s * 1.6),
  };
}

/** One-shot mechanism noises. Named for the mechanism, not for the sound. */
export type ClickKind = "transport" | "speed" | "detent" | "band" | "runout";

interface ClickSpec {
  centerHz: number;
  q: number;
  durMs: number;
  gain: number;
  /** A body thump under the click. Only the big switch gets one. */
  thumpHz?: number;
}

/**
 * Every switch on the deck is the same gesture with a different mass behind it,
 * so they are one spec table rather than five functions. START/STOP is a big
 * stiff switch with a plinth behind it; the speed buttons are small and dry; the
 * fader detent is a tiny sprung ball; the band tick and the run-out are the
 * stylus crossing land, which is not a switch at all and so is quieter and
 * duller than any of them.
 */
export const CLICKS: Record<ClickKind, ClickSpec> = {
  transport: { centerHz: 1900, q: 1.1, durMs: 16, gain: 0.30, thumpHz: 92 },
  speed: { centerHz: 3100, q: 1.6, durMs: 9, gain: 0.20 },
  detent: { centerHz: 4800, q: 2.4, durMs: 6, gain: 0.13 },
  band: { centerHz: 1700, q: 1.8, durMs: 7, gain: 0.10 },
  runout: { centerHz: 1150, q: 1.5, durMs: 11, gain: 0.14 },
};

export interface DeckSounds {
  /** Live settings; safe to call every frame. */
  setSettings(s: Partial<DeckSoundSettings>): void;
  /**
   * Drive the continuous beds. Call once per animation frame with the deck's
   * own `spinVel` and whether the stylus is in the groove — the same two numbers
   * the picture is drawn from, so the sound can never disagree with it.
   */
  frame(vel: number, needleDown: boolean): void;
  /** The needle meeting the groove. */
  drop(): void;
  /** The cue lever taking it off again. */
  lift(): void;
  click(kind: ClickKind): void;
  /** Drag speed in px/sec; call while cueing, then `endScrape()` on release. */
  scrape(speedPxPerSec: number): void;
  endScrape(): void;
  destroy(): void;
}

/** The silent object. Same shape, no context, no cost. */
function silentSounds(): DeckSounds {
  return {
    setSettings() {},
    frame() {},
    drop() {},
    lift() {},
    click() {},
    scrape() {},
    endScrape() {},
    destroy() {},
  };
}

/** Two seconds of white noise, generated once and shared by every voice. */
function noiseBuffer(ctx: AudioContext): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * 2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

export function createDeckSounds(
  ctx: AudioContext | null,
  initial: Partial<DeckSoundSettings> = {},
): DeckSounds {
  if (!ctx) return silentSounds();

  // `voices` merges rather than replaces, matching setSettings — otherwise
  // passing one switch at construction would silently drop the defaults for
  // every other.
  let settings: DeckSoundSettings = {
    ...DEFAULT_SOUND_SETTINGS,
    ...initial,
    voices: { ...DEFAULT_SOUND_SETTINGS.voices, ...(initial.voices ?? {}) },
  };
  let destroyed = false;

  const noise = noiseBuffer(ctx);

  // Master trim. Everything lands here, so the level slider and the master
  // toggle are one ramp rather than a change every voice has to hear about.
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);

  // ---- continuous beds -------------------------------------------------
  // Started once and left running, their gains driven from frame(). Starting
  // and stopping sources per state change would click at every transition,
  // which is the one noise the deck should not make.

  const rumbleSrc = ctx.createBufferSource();
  rumbleSrc.buffer = noise;
  rumbleSrc.loop = true;
  const rumbleFilter = ctx.createBiquadFilter();
  rumbleFilter.type = "lowpass";
  const rumbleGain = ctx.createGain();
  rumbleGain.gain.value = 0;
  rumbleSrc.connect(rumbleFilter).connect(rumbleGain).connect(master);
  rumbleSrc.start();

  // The motor's tone. Triangle rather than sine: a direct drive has some edge to
  // it, and a pure sine at these frequencies reads as a test tone.
  const tone = ctx.createOscillator();
  tone.type = "triangle";
  tone.frequency.value = 0;
  const toneGain = ctx.createGain();
  toneGain.gain.value = 0;
  tone.connect(toneGain).connect(master);
  tone.start();

  const hissSrc = ctx.createBufferSource();
  hissSrc.buffer = noise;
  hissSrc.loop = true;
  const hissFilter = ctx.createBiquadFilter();
  hissFilter.type = "highpass";
  hissFilter.frequency.value = 1400;
  const hissGain = ctx.createGain();
  hissGain.gain.value = 0;
  hissSrc.connect(hissFilter).connect(hissGain).connect(master);
  hissSrc.start();

  const scrapeSrc = ctx.createBufferSource();
  scrapeSrc.buffer = noise;
  scrapeSrc.loop = true;
  const scrapeFilter = ctx.createBiquadFilter();
  scrapeFilter.type = "bandpass";
  scrapeFilter.Q.value = 0.9;
  scrapeFilter.frequency.value = 400;
  const scrapeGain = ctx.createGain();
  scrapeGain.gain.value = 0;
  scrapeSrc.connect(scrapeFilter).connect(scrapeGain).connect(master);
  scrapeSrc.start();

  /** Short ramp to a target — `setTargetAtTime` never quite arrives, and a
   *  bed that never quite reaches zero is a bed that hisses forever. */
  function ramp(p: AudioParam, to: number, secs = 0.04) {
    const t = ctx!.currentTime;
    p.cancelScheduledValues(t);
    p.setValueAtTime(p.value, t);
    p.linearRampToValueAtTime(to, t + secs);
  }

  function applyMaster() {
    ramp(master.gain, settings.enabled ? Math.max(0, Math.min(1, settings.level)) : 0, 0.08);
  }
  applyMaster();

  /**
   * A filtered noise burst — the shape every one-shot here is made of.
   *
   * Built per trigger and left to be collected: these are milliseconds long and
   * a pool would be more machinery than the thing it manages.
   */
  function burst(o: {
    centerHz: number;
    q: number;
    durMs: number;
    gain: number;
    type?: BiquadFilterType;
    sweepToHz?: number;
  }) {
    if (destroyed || !settings.enabled) return;
    const t = ctx!.currentTime;
    const dur = o.durMs / 1000;
    const src = ctx!.createBufferSource();
    src.buffer = noise;
    // A random offset into the shared buffer, so repeated ticks aren't the
    // identical waveform every time — which is audible as a machine-gun.
    const off = Math.random() * (noise.duration - dur - 0.01);
    const f = ctx!.createBiquadFilter();
    f.type = o.type ?? "bandpass";
    f.frequency.setValueAtTime(o.centerHz, t);
    if (o.sweepToHz !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.sweepToHz), t + dur);
    f.Q.value = o.q;
    const g = ctx!.createGain();
    // Exponential decay, floored above zero — exponentialRamp cannot reach 0.
    g.gain.setValueAtTime(o.gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.max(0, off), dur + 0.02);
    src.onended = () => {
      src.disconnect();
      f.disconnect();
      g.disconnect();
    };
  }

  /** A sine thump with a fast decay — the body under a drop or a big switch. */
  function thump(freq: number, durMs: number, gain: number) {
    if (destroyed || !settings.enabled) return;
    const t = ctx!.currentTime;
    const dur = durMs / 1000;
    const osc = ctx!.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);
    // Pitch drops through the decay. A struck object does this, and without it
    // the thump reads as a bass note rather than an impact.
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * 0.55), t + dur);
    const g = ctx!.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
    };
  }

  let lastFrameAt: number | null = null;

  return {
    setSettings(s) {
      settings = { ...settings, ...s, voices: { ...settings.voices, ...(s.voices ?? {}) } };
      applyMaster();
      // Silence any bed whose switch just went off. The beds are always-running
      // sources steered by gain, so unlike the one-shots they need telling —
      // frame() will do it on the next tick, but a bed that keeps humming until
      // then is exactly the lag that makes a checkbox feel broken.
      if (!voiceOn(settings, "hiss")) ramp(hissGain.gain, 0, 0.1);
      if (!voiceOn(settings, "scrape")) ramp(scrapeGain.gain, 0, 0.1);
      if (!voiceOn(settings, "motor")) {
        ramp(rumbleGain.gain, 0, 0.1);
        ramp(toneGain.gain, 0, 0.1);
      }
    },

    frame(vel, needleDown) {
      if (destroyed) return;
      const now = ctx.currentTime;
      const dt = lastFrameAt === null ? 0 : Math.max(0, Math.min(0.25, now - lastFrameAt));
      lastFrameAt = now;
      if (!settings.enabled) return;

      if (voiceOn(settings, "motor")) {
        const r = rumbleParams(vel);
        // Straight assignment rather than a ramp: this runs every frame, so the
        // per-frame step IS the ramp, and scheduling one on top would fight it.
        rumbleFilter.frequency.value = r.cutoffHz;
        rumbleGain.gain.value = r.gain;
        tone.frequency.value = r.toneHz;
        toneGain.gain.value = r.toneHz > 1 ? TONE_GAIN : 0;
      }

      hissGain.gain.value = voiceOn(settings, "hiss") ? surfaceGain(vel, needleDown) : 0;

      if (voiceOn(settings, "crackle")) {
        // Poisson-ish: rate·dt is the expected count in this frame, which at a
        // few per second and 120Hz frames is a small probability per frame.
        const rate = crackleRate(vel, needleDown);
        if (rate > 0 && Math.random() < rate * dt) {
          burst({ centerHz: 1400 + Math.random() * 2600, q: 2.2, durMs: 4 + Math.random() * 6, gain: 0.02 + Math.random() * 0.09 });
        }
      }
    },

    drop() {
      if (!voiceOn(settings, "drop")) return;
      // The "gdoup": a body thump for the stylus meeting the record, and a
      // downward-swept noise burst for the groove noise arriving with it.
      thump(74, 130, 0.26);
      burst({ centerHz: 1500, q: 0.7, durMs: 95, gain: 0.30, type: "lowpass", sweepToHz: 190 });
    },

    lift() {
      if (!voiceOn(settings, "lift")) return;
      // Shorter, brighter and swept the other way. Taking the needle off is a
      // smaller event than putting it on, and sounds like less.
      burst({ centerHz: 900, q: 0.9, durMs: 55, gain: 0.17, sweepToHz: 1700 });
    },

    click(kind) {
      // Each switch is its own voice, so `kind` is both which sound to make and
      // which checkbox governs it.
      if (!voiceOn(settings, kind)) return;
      const c = CLICKS[kind];
      burst({ centerHz: c.centerHz, q: c.q, durMs: c.durMs, gain: c.gain });
      if (c.thumpHz) thump(c.thumpHz, 55, 0.14);
    },

    scrape(speedPxPerSec) {
      if (destroyed) return;
      if (!voiceOn(settings, "scrape")) {
        ramp(scrapeGain.gain, 0, 0.05);
        return;
      }
      const p = scrapeParams(speedPxPerSec);
      scrapeFilter.frequency.value = p.centerHz;
      // Fast attack, so a flick is heard on the frame it happens.
      ramp(scrapeGain.gain, p.gain, 0.02);
    },

    endScrape() {
      if (destroyed) return;
      ramp(scrapeGain.gain, 0, 0.08);
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const s of [rumbleSrc, hissSrc, scrapeSrc]) {
        try {
          s.stop();
        } catch {
          // Already stopped — a double destroy is not an error worth raising.
        }
      }
      try {
        tone.stop();
      } catch {
        // As above.
      }
      master.disconnect();
    },
  };
}
