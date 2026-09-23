import { describe, expect, it } from "vitest";
import {
  barStartTime,
  quarterBpmOf,
  tempoAtBar,
  tempoMarkAt,
  validateBar,
} from "../src/operations/index.js";
import { TICKS_PER_QUARTER, type Bar, type Score } from "../src/model/index.js";

const bar = (tempo: number | null, tempoUnit?: number): Bar => ({
  id: 1 as never,
  timeSignature: { numerator: 4, denominator: 4 },
  keyChange: null,
  tempo,
  ...(tempoUnit !== undefined ? { tempoUnit } : {}),
  voices: [{ notes: [] }],
});

describe("tempoAtBar", () => {
  it("carries previous tempo through nulls", () => {
    const score = { bars: [bar(90), bar(null), bar(140), bar(null)] } as unknown as Score;
    expect(tempoAtBar(score, 0)).toBe(90);
    expect(tempoAtBar(score, 1)).toBe(90);
    expect(tempoAtBar(score, 2)).toBe(140);
    expect(tempoAtBar(score, 3)).toBe(140);
  });

  it("defaults to 120 when no tempo set", () => {
    const score = { bars: [bar(null)] } as unknown as Score;
    expect(tempoAtBar(score, 0)).toBe(120);
  });
});

describe("tempoMarkAt", () => {
  it("resolves the nearest notated mark with its beat unit", () => {
    const score = { bars: [bar(85, 240), bar(null), bar(96, 360)] } as unknown as Score;
    expect(tempoMarkAt(score, 0)).toEqual({ bpm: 85, unitTicks: 240 });
    expect(tempoMarkAt(score, 1)).toEqual({ bpm: 85, unitTicks: 240 });
    expect(tempoMarkAt(score, 2)).toEqual({ bpm: 96, unitTicks: 360 });
    expect(tempoMarkAt({ bars: [bar(null)] } as unknown as Score, 0)).toBeNull();
  });

  it("quarterBpmOf converts dotted/eighth units into quarter-BPM", () => {
    expect(quarterBpmOf({ bpm: 85, unitTicks: TICKS_PER_QUARTER / 2 })).toBe(42.5);
    expect(quarterBpmOf({ bpm: 85, unitTicks: 360 })).toBeCloseTo(63.75, 5);
    expect(quarterBpmOf({ bpm: 96, unitTicks: TICKS_PER_QUARTER })).toBe(96);
  });

  it("tempoAtBar respects the notated unit", () => {
    const score = { bars: [bar(85, 240), bar(null)] } as unknown as Score;
    expect(tempoAtBar(score, 1)).toBeCloseTo(42.5, 5);
  });
});

describe("barStartTime", () => {
  it("accumulates bar durations respecting tempo", () => {
    const score = { bars: [bar(120), bar(60)] } as unknown as Score;
    expect(barStartTime(score, 0)).toBe(0);
    expect(barStartTime(score, 1)).toBeCloseTo(2, 5); // 4 beats @120
    expect(barStartTime(score, 2)).toBeCloseTo(6, 5); // + 4 beats @60
  });
});

describe("validateBar", () => {
  it("rejects notes exceeding the bar", () => {
    const bad: Bar = {
      id: 1 as never,
      timeSignature: { numerator: 4, denominator: 4 },
      keyChange: null,
      tempo: null,
      voices: [
        {
          notes: [
            {
              id: 1 as never,
              pitch: 60,
              string: null,
              fret: null,
              start: TICKS_PER_QUARTER * 3,
              duration: TICKS_PER_QUARTER * 2,
              velocity: 100,
              articulations: [],
            },
          ],
        },
      ],
    };
    expect(validateBar(bad)).toHaveLength(1);
  });
});
