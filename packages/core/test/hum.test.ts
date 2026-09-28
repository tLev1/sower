import { describe, expect, it } from "vitest";
import {
  MIN_NOTE_TICKS,
  STANDARD_DURATIONS,
  TICKS_PER_QUARTER,
  humCorrectionPitch,
  quantizeHumNotes,
} from "../src/index.js";

describe("quantizeHumNotes", () => {
  it("snaps sung onsets to the entry grid", () => {
    const out = quantizeHumNotes(
      [
        { midi: 57, startSec: 0, endSec: 0.5 },
        { midi: 60, startSec: 0.5, endSec: 1.0 },
      ],
      { quarterBpm: 120, gridTicks: TICKS_PER_QUARTER },
    );
    // 120 bpm → a quarter is 0.5 s = 480 ticks
    expect(out).toEqual([
      { pitch: 57, start: 0, duration: 480 },
      { pitch: 60, start: 480, duration: 480 },
    ]);
  });

  it("follows the tempo of the entry point", () => {
    const out = quantizeHumNotes([{ midi: 60, startSec: 0, endSec: 1 }], {
      quarterBpm: 60,
      gridTicks: TICKS_PER_QUARTER,
    });
    expect(out[0]?.start).toBe(0);
    expect(out[0]?.duration).toBe(480); // 1 s at 60 bpm = one quarter
  });

  it("offsets from the caret's tick", () => {
    const out = quantizeHumNotes([{ midi: 60, startSec: 0, endSec: 0.5 }], {
      quarterBpm: 120,
      gridTicks: 240,
      fromTick: 960,
    });
    expect(out[0]?.start).toBe(960);
  });

  it("durations snap to standard rhythm values and never overlap", () => {
    const out = quantizeHumNotes(
      [
        { midi: 57, startSec: 0, endSec: 0.31 },
        { midi: 60, startSec: 0.31, endSec: 0.75 },
        { midi: 62, startSec: 0.75, endSec: 1.0 },
      ],
      { quarterBpm: 120, gridTicks: 120 },
    );
    expect(out).toHaveLength(3);
    for (const n of out) {
      expect(STANDARD_DURATIONS).toContain(n.duration);
      expect(n.duration).toBeGreaterThanOrEqual(MIN_NOTE_TICKS);
    }
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.start).toBeGreaterThanOrEqual(out[i - 1]!.start + out[i - 1]!.duration);
    }
  });

  it("collapses onsets that quantise to the same tick", () => {
    const out = quantizeHumNotes(
      [
        { midi: 57, startSec: 0, endSec: 0.05 },
        { midi: 58, startSec: 0.02, endSec: 0.2 },
      ],
      { quarterBpm: 120, gridTicks: TICKS_PER_QUARTER },
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.pitch).toBe(57);
  });

  it("honours the note cap", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      midi: 60,
      startSec: i * 0.5,
      endSec: i * 0.5 + 0.4,
    }));
    const out = quantizeHumNotes(many, { quarterBpm: 120, gridTicks: 240, maxNotes: 5 });
    expect(out).toHaveLength(5);
  });

  it("handles an empty capture", () => {
    expect(quantizeHumNotes([], { quarterBpm: 120, gridTicks: 240 })).toEqual([]);
  });
});

describe("humCorrectionPitch", () => {
  it("takes the median sung pitch", () => {
    expect(
      humCorrectionPitch([
        { midi: 57, startSec: 0, endSec: 0.1 },
        { midi: 60, startSec: 0.1, endSec: 0.2 },
        { midi: 62, startSec: 0.2, endSec: 0.3 },
      ]),
    ).toBe(60);
  });

  it("returns null when nothing was sung", () => {
    expect(humCorrectionPitch([])).toBeNull();
  });
});
