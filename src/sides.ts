// Splitting a long queue across record sides.
//
// A 12" LP holds about 22 minutes a side, and that limit is what the deck uses:
// fill a side until the next track won't fit, then start another. It is the real
// constraint, and it is also the one that keeps the pressing legible.
//
// WHY TIME AND NOT TRACK COUNT. A count cap looks like the obvious rule, since
// what actually goes wrong with a long queue is that bands get too thin to aim a
// cue drag at. But band width is proportional to a track's SHARE of its side, so
// a cap alone still allows a side holding one 30-minute track and eleven 2-minute
// ones — the long one takes 58% of the record and the rest are squeezed to a few
// pixels each. Filling by time can't produce that: the 30-minute track exceeds a
// side on its own and gets one to itself, and the eleven short ones then split a
// side evenly. Time bounds the imbalance, not just the count.
//
// The count cap survives as a BACKSTOP, for the case time can't catch: sixty
// twenty-second tracks fit inside 22 minutes and would press sixty hairlines.
//
// Measured, for the thresholds below: on the SL-1200 livery the program area is
// ~125px, so ten bands are ~10.7px each and forty are ~1.6px. Under ~2px a band
// is thinner than the land beside it, and the painter's 1.15px groove pitch means
// it gets a single ring and its waveform texture stops rendering.

/** Playing time a side holds. A 12" LP at 33⅓ is about 22 minutes. */
export const SIDE_SECS = 22 * 60;

/**
 * Hard cap on tracks per side, whatever the running time.
 *
 * Only bites on queues of very short tracks, where the time limit alone would
 * still press an unaimable number of bands. Fourteen keeps the tightest livery
 * above ~7px a band.
 */
export const MAX_TRACKS_PER_SIDE = 14;

export interface Side {
  /** Zero-based side number. */
  index: number;
  /** Queue index of this side's first track. */
  start: number;
  /** How many tracks are on it. */
  count: number;
  /** Total playing time of the tracks on it, seconds. */
  secs: number;
  /** How many sides the queue makes in total. */
  of: number;
}

/** Durations are optional and often unknown; an unknown one buys no time. */
function usable(d: number | null | undefined): number {
  return typeof d === "number" && Number.isFinite(d) && d > 0 ? d : 0;
}

/**
 * Cut a queue into sides.
 *
 * A track is never split across sides — one longer than a whole side simply gets
 * a side to itself, which is what a pressing plant would do too.
 *
 * Tracks with no duration contribute nothing to the time budget rather than an
 * invented nominal: the count cap is already the right answer for "we can't tell
 * how long these are", so there's no need to guess a number that would then be
 * wrong in a specific way.
 */
export function splitSides(
  durations: readonly (number | null | undefined)[],
  sideSecs: number = SIDE_SECS,
  maxTracks: number = MAX_TRACKS_PER_SIDE,
): Side[] {
  const n = durations.length;
  if (n === 0) return [];

  const sides: Side[] = [];
  let start = 0;
  let secs = 0;
  let count = 0;

  for (let i = 0; i < n; i++) {
    const d = usable(durations[i]);
    // `count > 0` is what stops an over-long track producing an empty side ahead
    // of itself: it always joins the side it opens, then closes it.
    if (count > 0 && (secs + d > sideSecs || count >= maxTracks)) {
      sides.push({ index: sides.length, start, count, secs, of: 0 });
      start = i;
      secs = 0;
      count = 0;
    }
    secs += d;
    count++;
  }
  sides.push({ index: sides.length, start, count, secs, of: 0 });

  for (const s of sides) s.of = sides.length;
  return sides;
}

/**
 * The side holding a queue index.
 *
 * Out-of-range clamps rather than returning null: a non-empty queue always has a
 * side to show, and `currentIndex` is legitimately -1 before anything plays.
 */
export function sideAt(sides: readonly Side[], queueIndex: number): Side | null {
  if (sides.length === 0) return null;
  const i = Math.floor(queueIndex);
  if (!(i > 0)) return sides[0];
  for (let s = sides.length - 1; s >= 0; s--) {
    if (i >= sides[s].start) return sides[s];
  }
  return sides[0];
}

/**
 * What to etch in the dead wax, or null when the queue fits one side.
 *
 * A single-side queue is just a record; "SIDE 1 OF 1" on it would be noise. The
 * label only earns its place once there is somewhere else to be.
 */
export function sideLabel(side: Side | null): string | null {
  if (!side || side.of <= 1) return null;
  return `SIDE ${side.index + 1} OF ${side.of}`;
}
