import { describe, it, expect } from "vitest";
import {
  MAX_TRACKS_PER_SIDE,
  SIDE_SECS,
  sideAt,
  sideLabel,
  splitSides,
} from "./sides";
import { buildGeometry, layoutBands } from "./geometry";

const mins = (m: number) => m * 60;

describe("splitSides", () => {
  it("keeps a queue that fits on one side whole", () => {
    const sides = splitSides([mins(5), mins(6), mins(4)]);
    expect(sides).toHaveLength(1);
    expect(sides[0]).toMatchObject({ index: 0, start: 0, count: 3, of: 1 });
  });

  it("starts a new side when the next track will not fit", () => {
    // 4 x 7min = 28min: three fit (21), the fourth opens a second side.
    const sides = splitSides([mins(7), mins(7), mins(7), mins(7)]);
    expect(sides).toHaveLength(2);
    expect(sides[0]).toMatchObject({ start: 0, count: 3 });
    expect(sides[1]).toMatchObject({ start: 3, count: 1 });
  });

  it("fills a side rather than balancing across sides", () => {
    // A pressing plant fills side A then starts side B; it does not even them out.
    const sides = splitSides(Array.from({ length: 10 }, () => mins(5)));
    expect(sides[0].count).toBe(4); // 20min, a fifth would make 25
    expect(sides[0].secs).toBe(mins(20));
  });

  it("gives a track longer than a whole side its own side, without an empty one first", () => {
    const sides = splitSides([mins(4), mins(40), mins(4)]);
    expect(sides.map((s) => s.count)).toEqual([1, 1, 1]);
    expect(sides[1]).toMatchObject({ start: 1, count: 1, secs: mins(40) });
  });

  it("never splits a single track across two sides", () => {
    const sides = splitSides([mins(40), mins(40)]);
    expect(sides).toHaveLength(2);
    expect(sides.every((s) => s.count === 1)).toBe(true);
  });

  it("caps the count for queues of very short tracks", () => {
    // THE case time alone cannot catch: sixty 20-second tracks are 20 minutes, so
    // the time limit never trips, and sixty hairline bands would be unaimable.
    const sides = splitSides(Array.from({ length: 60 }, () => 20));
    expect(sides[0].count).toBe(MAX_TRACKS_PER_SIDE);
    expect(sides.length).toBe(Math.ceil(60 / MAX_TRACKS_PER_SIDE));
  });

  it("falls back to the count cap when durations are unknown", () => {
    // Unknown durations buy no time, so the cap is what bounds the side — which is
    // the right answer for "we can't tell how long these are".
    const sides = splitSides(Array.from({ length: 30 }, () => null));
    expect(sides[0].count).toBe(MAX_TRACKS_PER_SIDE);
  });

  it("has no sides for an empty queue", () => {
    expect(splitSides([])).toEqual([]);
  });

  it("numbers every side and tells each one the total", () => {
    const sides = splitSides(Array.from({ length: 9 }, () => mins(8)));
    expect(sides.map((s) => s.index)).toEqual([0, 1, 2, 3, 4]);
    expect(new Set(sides.map((s) => s.of))).toEqual(new Set([5]));
  });

  it("covers the queue exactly once, whatever the mix", () => {
    const mixed = [mins(30), 15, null, mins(9), mins(9), mins(9), 20, 20, mins(45)];
    const sides = splitSides(mixed);
    let seen = 0;
    for (const s of sides) {
      expect(s.start).toBe(seen);
      seen += s.count;
    }
    expect(seen).toBe(mixed.length);
  });
});

describe("why time and not track count", () => {
  it("stops one long track squeezing the rest of its side to hairlines", () => {
    // THE reason for the rule. A count cap allows a side holding one 30-minute
    // track and eleven 2-minute ones: the long one takes ~58% of the record and
    // the short ones get a few pixels each, because band width is proportional to
    // a track's SHARE of its side. Filling by time cannot produce that pressing.
    const durations = [mins(30), ...Array.from({ length: 11 }, () => mins(2))];
    const geo = buildGeometry(442); // the tighter livery at a realistic size

    // What a count cap would have pressed: all twelve on one side.
    const squeezed = layoutBands(durations, geo);
    const thinnestSqueezed = Math.min(...squeezed.map((b) => b.width));

    // What filling by time presses: the long track alone, then the short ones.
    const sides = splitSides(durations);
    expect(sides[0]).toMatchObject({ start: 0, count: 1 });
    const fair = layoutBands(durations.slice(sides[1].start, sides[1].start + sides[1].count), geo);
    const thinnestFair = Math.min(...fair.map((b) => b.width));

    expect(thinnestSqueezed).toBeLessThan(5); // unaimable
    expect(thinnestFair).toBeGreaterThan(8); // comfortable
    expect(thinnestFair).toBeGreaterThan(thinnestSqueezed * 2);
  });

  it("holds a side's running time to what a 12in LP actually takes", () => {
    const sides = splitSides(Array.from({ length: 40 }, () => mins(6)));
    for (const s of sides) expect(s.secs).toBeLessThanOrEqual(SIDE_SECS);
  });
});

describe("sideAt", () => {
  const sides = splitSides(Array.from({ length: 12 }, () => mins(6))); // 3/side → 4 sides

  it("finds the side holding an index", () => {
    expect(sideAt(sides, 0)?.index).toBe(0);
    expect(sideAt(sides, 2)?.index).toBe(0);
    expect(sideAt(sides, 3)?.index).toBe(1);
    expect(sideAt(sides, 11)?.index).toBe(3);
  });

  it("clamps rather than returning null, since -1 is a real currentIndex", () => {
    expect(sideAt(sides, -1)?.index).toBe(0);
    expect(sideAt(sides, 999)?.index).toBe(3);
  });

  it("has nothing to show for an empty queue", () => {
    expect(sideAt([], 0)).toBeNull();
  });

  it("is stable while playing through a side, so the record is not re-pressed", () => {
    const starts = [0, 1, 2].map((i) => sideAt(sides, i)?.start);
    expect(new Set(starts)).toEqual(new Set([0]));
  });
});

describe("sideLabel", () => {
  it("says nothing when the queue fits one side", () => {
    expect(sideLabel(sideAt(splitSides([mins(5), mins(5)]), 0))).toBeNull();
    expect(sideLabel(null)).toBeNull();
  });

  it("names the side once there is more than one", () => {
    const sides = splitSides(Array.from({ length: 12 }, () => mins(6)));
    expect(sideLabel(sideAt(sides, 0))).toBe("SIDE 1 OF 4");
    expect(sideLabel(sideAt(sides, 11))).toBe("SIDE 4 OF 4");
  });
});
