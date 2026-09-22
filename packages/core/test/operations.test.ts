import { describe, expect, it } from "vitest";
import { barStartTime, tempoAtBar, validateBar } from "../src/operations/index.js";
import { TICKS_PER_QUARTER, type Bar, type Score } from "../src/model/index.js";

const bar = (tempo: number | null): Bar => ({
  id: 1 as never,
  timeSignature: { numerator: 4, denominator: 4 },
  keyChange: null,
  tempo,
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
