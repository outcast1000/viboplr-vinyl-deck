import { describe, it, expect } from "vitest";
import {
  BASES,
  PITCH_RANGE,
  RATE_45,
  RATE_78,
  clampPercent,
  composeRate,
  decomposeRate,
  formatPercent,
  percentToTravel,
  travelToPercent,
} from "./pitch";

describe("decomposeRate", () => {
  // The load-bearing property: the deck derives BOTH which speed button is lit
  // and where the fader sits from the host's single `rate`, keeping no memory of
  // which button was pressed. If a rate could map to two (speed, trim) pairs the
  // whole stateless design collapses and the controls could describe something
  // that isn't playing.
  it("reads an untrimmed speed as that speed at 0%", () => {
    for (const basis of BASES) {
      const d = decomposeRate(basis);
      expect(d.basis).toBeCloseTo(basis, 10);
      expect(d.percent).toBeCloseTo(0, 10);
    }
  });

  it("round-trips every speed across the whole fader range", () => {
    for (const basis of BASES) {
      for (const percent of [-8, -5.5, -0.4, 0, 0.4, 3.2, 8]) {
        const d = decomposeRate(composeRate(basis, percent));
        expect(d.basis).toBeCloseTo(basis, 10);
        expect(d.percent).toBeCloseTo(percent, 8);
      }
    }
  });

  it("keeps the speeds' ranges disjoint, which is what makes it unambiguous", () => {
    // 33 tops out at 1.08 and 45 starts at 1.242. At the real deck's OTHER range
    // (±16%) they would touch — 1.16 vs 1.134 — and this test would fail, which
    // is exactly the warning that ±16% needs remembered state instead.
    const windows = BASES.map((b) => [composeRate(b, -PITCH_RANGE), composeRate(b, PITCH_RANGE)]);
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i][0]).toBeGreaterThan(windows[i - 1][1]);
    }
  });

  it("picks the nearest speed for a rate between two of them", () => {
    expect(decomposeRate(1.1).basis).toBe(1);
    expect(decomposeRate(1.2).basis).toBeCloseTo(RATE_45, 10);
    expect(decomposeRate(2.0).basis).toBeCloseTo(RATE_78, 10);
  });

  it("reports the true trim rather than clamping, so a wild rate isn't disguised", () => {
    // A rate set elsewhere (Settings, another visualizer) can be far off any
    // speed. The knob clamps its own position; the maths tells the truth.
    expect(decomposeRate(4).percent).toBeGreaterThan(PITCH_RANGE);
  });

  it("falls back to normal speed for a nonsense rate", () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(decomposeRate(bad)).toEqual({ basis: 1, percent: 0 });
    }
  });
});

describe("composeRate", () => {
  it("trims the basis by the percentage", () => {
    expect(composeRate(1, 8)).toBeCloseTo(1.08, 10);
    expect(composeRate(1, -8)).toBeCloseTo(0.92, 10);
    expect(composeRate(RATE_45, 0)).toBeCloseTo(RATE_45, 10);
  });

  it("never exceeds the fader's range, whatever it is handed", () => {
    expect(composeRate(1, 500)).toBeCloseTo(1.08, 10);
    expect(composeRate(1, -500)).toBeCloseTo(0.92, 10);
    expect(composeRate(1, NaN)).toBeCloseTo(1, 10);
  });
});

describe("travel", () => {
  it("puts 0% at the centre of the slot", () => {
    expect(percentToTravel(0)).toBeCloseTo(0.5, 10);
  });

  it("runs minus at the top and plus at the bottom, the Technics way round", () => {
    // You push a Technics fader away from you to slow the record down.
    expect(percentToTravel(-PITCH_RANGE)).toBeCloseTo(0, 10);
    expect(percentToTravel(PITCH_RANGE)).toBeCloseTo(1, 10);
  });

  it("round-trips against travelToPercent outside the detent", () => {
    for (const p of [-8, -4, -1, 1, 4, 8]) {
      expect(travelToPercent(percentToTravel(p))).toBeCloseTo(p, 10);
    }
  });

  it("snaps near the centre, so the deck can't sit imperceptibly off-speed", () => {
    // Without the detent the fader parks at 0.2%: inaudible, but the readout says
    // off-speed and the strobe dots crawl, which reads as a bug not a setting.
    expect(travelToPercent(0.5 + 0.001)).toBe(0);
    expect(travelToPercent(0.5 - 0.001)).toBe(0);
    expect(travelToPercent(0.5 + 0.05)).not.toBe(0);
  });

  it("clamps a drag past either end of the slot", () => {
    expect(travelToPercent(-3)).toBeCloseTo(-PITCH_RANGE, 10);
    expect(travelToPercent(9)).toBeCloseTo(PITCH_RANGE, 10);
  });
});

describe("formatPercent", () => {
  it("signs the readout and keeps one decimal", () => {
    expect(formatPercent(0)).toBe("0.0%");
    expect(formatPercent(3.24)).toBe("+3.2%");
    expect(formatPercent(-3.24)).toBe("−3.2%"); // real minus sign, not a hyphen
  });

  it("never shows a value the fader can't reach", () => {
    expect(formatPercent(99)).toBe(`+${PITCH_RANGE.toFixed(1)}%`);
  });
});

describe("clampPercent", () => {
  it("bounds to the fader range and treats nonsense as centred", () => {
    expect(clampPercent(20)).toBe(PITCH_RANGE);
    expect(clampPercent(-20)).toBe(-PITCH_RANGE);
    expect(clampPercent(NaN)).toBe(0);
  });
});
