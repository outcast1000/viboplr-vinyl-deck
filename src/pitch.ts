// The pitch fader: a trim on top of whichever speed the deck is set to.
//
// Pure and unit-tested, because the interesting part isn't the dragging — it's
// that the deck has to work out, from a single number, both which speed button is
// lit AND where the fader knob sits.
//
// It CAN, and that is the whole design. The plugin keeps no local memory of
// "which button did I press" — everything is derived from the host's `state.rate`
// on each frame, so a speed changed in Settings, or by another surface, can never
// leave the deck's controls describing something that isn't playing. That is the
// same rule the speed buttons already follow.

/**
 * Fader travel, in percent either side of the selected speed.
 *
 * 8 is the SL-1200's default range (the real deck can also switch to 16). 8 is
 * also what keeps the decomposition below unambiguous — see BASES.
 */
export const PITCH_RANGE = 8;

/** 45 and 78 expressed against a 33⅓ pressing. */
export const RATE_45 = 45 / (100 / 3);
export const RATE_78 = 78 / (100 / 3);

/**
 * The speeds a rate can be sitting on.
 *
 * Their ±8% windows do not overlap — 33 reaches 1.08, 45 starts at 1.242 — so a
 * rate maps back to exactly one (speed, trim) pair. At the real deck's *other*
 * range, ±16%, they would just touch (1.16 vs 1.134), and the deck would have to
 * remember which button you pressed instead of deriving it. Modelling ±8% only is
 * what buys the stateless design.
 */
export const BASES = [1, RATE_45, RATE_78];

export interface PitchState {
  /** The speed the fader is trimming: 1, RATE_45 or RATE_78. */
  basis: number;
  /** Trim in percent. NOT clamped — a rate far from any speed reports the truth
   *  and lets the caller decide what the knob can show. */
  percent: number;
}

/** Split a playback rate into the speed it sits on and the trim off it. */
export function decomposeRate(rate: number): PitchState {
  const safe = Number.isFinite(rate) && rate > 0 ? rate : 1;
  let best: PitchState = { basis: 1, percent: 0 };
  let bestErr = Infinity;
  for (const basis of BASES) {
    const percent = (safe / basis - 1) * 100;
    if (Math.abs(percent) < bestErr) {
      bestErr = Math.abs(percent);
      best = { basis, percent };
    }
  }
  return best;
}

/** Recombine a speed and a trim into the rate to ask the host for. */
export function composeRate(basis: number, percent: number): number {
  return basis * (1 + clampPercent(percent) / 100);
}

export function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.max(-PITCH_RANGE, Math.min(PITCH_RANGE, percent));
}

/**
 * Knob travel (0 = top of the slot, 1 = bottom) for a trim.
 *
 * DOWN IS FASTER, which is the Technics convention: the + marks are at the front
 * of the deck, nearest the user, and you push the fader away to slow the record
 * down. The +/- marks beside the slot say so on screen, since it is the one thing
 * here nobody can guess from the shape.
 */
export function percentToTravel(percent: number): number {
  return 0.5 + clampPercent(percent) / (PITCH_RANGE * 2);
}

/** Inverse of `percentToTravel`, with the centre detent a real fader has. */
export function travelToPercent(travel: number): number {
  const t = Math.max(0, Math.min(1, travel));
  const percent = (t - 0.5) * PITCH_RANGE * 2;
  // Snap near zero. Without it the fader can sit at 0.2% forever — inaudible,
  // but the readout says the deck is off-speed and the strobe dots crawl, which
  // reads as a bug rather than as a setting.
  return Math.abs(percent) < 0.35 ? 0 : percent;
}

/** Fader label, e.g. "+3.2%" / "0.0%". */
export function formatPercent(percent: number): string {
  const p = clampPercent(percent);
  return `${p > 0 ? "+" : p < 0 ? "−" : ""}${Math.abs(p).toFixed(1)}%`;
}
