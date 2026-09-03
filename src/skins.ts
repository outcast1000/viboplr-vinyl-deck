// Deck liveries.
//
// A skin is NOT a setting. Each one is contributed to the host as its own
// visualizer (see index.ts), so the user picks a deck from the visualizer picker
// they already use to choose between the deck and the artwork. That is why
// stripping the options in 1.0.1 didn't have to be undone to add this: there is
// no panel, no stored preference, and no live options object mutated behind a
// running instance — the skin is baked in at mount and never changes.
//
// It also reads better. "Which deck is this?" is a different question from
// "distort the deck by 28 degrees", and it belongs in the same list as "show me
// the artwork instead".

import { ARM, type ArmSpec } from "./geometry";

export type DeckSkin = "studio" | "sl1200";

export interface SkinConfig {
  /** Goes on `.deck` as `skin-<name>`, so the CSS can select the livery. */
  name: DeckSkin;
  /**
   * Plinth width / height. The plinth takes the slot's short side as its WIDTH
   * and derives its height, so a landscape deck stays landscape however the slot
   * is shaped.
   *
   * This matters more than it looks. Forcing the plinth square was the first
   * attempt, and it put the record over the bottom-left controls — a square box
   * has to shrink the disc absurdly before a landscape deck's furniture fits
   * around it. 1 for a skin with no plinth.
   */
  aspect: number;
  /**
   * Record diameter as a fraction of the PLINTH WIDTH.
   *
   * The studio deck fills its box (1). A skin with a plinth has to leave room
   * around the platter for the controls that make it recognisable.
   */
  platterScale: number;
  /** Platter centre offset from the deck centre, as fractions of the deck box. */
  offsetX: number;
  offsetY: number;
  arm: ArmSpec;
  /** Draw the plinth and its control furniture. */
  furniture: boolean;
  /**
   * Where the cue lever sits: `x` as a fraction of the plinth's width, `y` of its
   * height.
   *
   * Omitted means "on the 45-degree diagonal outside the disc", which is the
   * right answer for a bare record: it is the roomiest corner and the one the arm
   * never visits. A deck with a plinth has a real place for it instead — beside
   * the arm base, where your hand already is.
   */
  leverAt?: { x: number; y: number };
  /**
   * Centre of the tonearm rest, in the same plinth fractions as `leverAt`.
   *
   * THE POST AND THE PARKED ARM READ THIS SAME VALUE — repress() positions the
   * `.rest` element from it and derives the park angle from it, so the arm cannot
   * come to rest anywhere but on the thing it is resting on. It was two numbers
   * once (a CSS `left`/`top` and, separately, wherever the arm happened to swing)
   * and that is exactly the kind of pair that drifts apart on the next nudge.
   *
   * Omitted means the livery has no rest — and therefore no park. Only a deck with
   * furniture has a START/STOP to park FROM (see visualizer.ts), so a bare record
   * never needs one.
   */
  restAt?: { x: number; y: number };
  /**
   * Where the hover lens aims: the READING ZONE's angle on the disc, in degrees
   * clockwise from 3 o'clock (screen y grows downward, so 45 is the disc's
   * bottom-right diagonal). Each deck aims the lens where its own arm and
   * furniture leave the grooves unobstructed.
   */
  lensZoneDeg: number;
  /**
   * The zone's radial seat, as the fraction of the way from the innermost
   * program groove out to the lead-in (0.5 = the middle of the program area,
   * 1 = the outermost groove). Kept inside the recorded band on purpose — a
   * zone past the lead-in magnifies run-off and slipmat, not music.
   */
  lensZoneR: number;
}

/**
 * The original: a record on black, and nothing that isn't the record or the arm.
 */
const STUDIO: SkinConfig = {
  name: "studio",
  aspect: 1,
  platterScale: 1,
  offsetX: 0,
  offsetY: 0,
  arm: ARM,
  furniture: false,
  // Well down the bottom-right diagonal, toward the disc's corner: seated at
  // the outer reaches of the program area rather than its middle, so the lens
  // sits low and right without leaving the grooves. Not further, or it would
  // crowd the cue lever parked just outside the disc on this same diagonal.
  lensZoneDeg: 45,
  lensZoneR: 0.85,
};

/**
 * Silver direct-drive deck, after the SL-1200 MK7 seen from above.
 *
 * Proportions read off the product photo (plinth 535x450 in frame, so ~1.19:1):
 * the platter centre sits at 0.39 of the width, i.e. 0.11 left of centre, and
 * the platter is ~0.78 of the short side. That clearance is what buys the pitch
 * fader, the START·STOP button and the arm cluster their space — and it is also
 * what lets this skin use the deck's REAL arm geometry, which the inscribed
 * studio disc cannot fit.
 *
 * Arm numbers are the actual SL-1200's, expressed against the record radius:
 * pivot-to-spindle 215mm / 151mm = 1.42, effective length 230mm / 151mm = 1.52,
 * and the pivot sits ~23 degrees above the platter's horizontal (measured off the
 * same photo) rather than the studio deck's compressed 38.
 *
 * NOTE the record. The photo shows a bare slipmat, because a deck at rest has no
 * record on it — but this plugin exists to draw the queue AS a record, so the
 * slipmat is never visible and is not modelled. What the skin adopts is the deck
 * *around* the disc: the plinth, the platter rim and its strobe dots, the arm,
 * and the controls.
 */
const SL1200: SkinConfig = {
  name: "sl1200",
  // 535 x 450 in the reference photo.
  aspect: 1.19,
  // The record is 302mm across a 453mm plinth = 0.667. Pulled in slightly so the
  // platter's rim and its strobe dots have somewhere to be.
  platterScale: 0.64,
  offsetX: -0.11,
  offsetY: 0,
  arm: { pivotAngleDeg: -23, pivotDistance: 1.42, length: 1.52 },
  furniture: true,
  leverAt: { x: 0.905, y: 0.47 },
  // Below the pivot, so the arm swings outward off the disc to reach it — the way
  // an arm comes off a record. Pulled ~4% left of the photo's post, because
  // this deck's arm is at TRUE SL-1200 proportions against a slightly smaller
  // record — aimed at the photo's spot the shell overhung the pitch scale, and a
  // parked arm lying across another control reads as a collision, not a rest.
  restAt: { x: 0.8, y: 0.82 },
  // Steeper than the studio deck's 45: this arm's pivot sits only 23° above the
  // horizontal, so its tube crosses the disc's right-middle almost flat and a
  // shallow zone would spend the end of every side magnifying tonearm. 75 tucks
  // the zone under the arm's sweep, nearly at the disc's six o'clock, and
  // mid-program keeps it centred in the band the needle actually reads.
  lensZoneDeg: 75,
  lensZoneR: 0.5,
};

export const SKINS: Record<DeckSkin, SkinConfig> = {
  studio: STUDIO,
  sl1200: SL1200,
};

/** Unknown names fall back to the plain deck rather than rendering nothing. */
export function skinConfig(skin: DeckSkin): SkinConfig {
  return SKINS[skin] ?? STUDIO;
}
