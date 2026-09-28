import { describe, expect, it } from "vitest";
import {
  MAX_FRET,
  MIN_NOTE_TICKS,
  STANDARD_DURATIONS,
  STANDARD_GUITAR_TUNING,
  bestFingering,
  durationLabel,
  fretForPitch,
  maxStandardDuration,
  openPitchForString,
  snapDuration,
} from "../src/index.js";

describe("fingering", () => {
  it("maps visual string 0 to the highest open string", () => {
    expect(openPitchForString(STANDARD_GUITAR_TUNING, 0)).toBe(64); // E4
    expect(openPitchForString(STANDARD_GUITAR_TUNING, 2)).toBe(55); // G3
    expect(openPitchForString(STANDARD_GUITAR_TUNING, 5)).toBe(40); // E2
  });

  it("derives the fret needed on a string", () => {
    // G3 = 55 is the open 3rd string (visual index 2)
    expect(fretForPitch(STANDARD_GUITAR_TUNING, 2, 55)).toBe(0);
    expect(fretForPitch(STANDARD_GUITAR_TUNING, 2, 58)).toBe(3);
    expect(fretForPitch(STANDARD_GUITAR_TUNING, 3, 55)).toBe(5); // D3 + 5
  });

  it("keeps the preferred string when the pitch is playable there", () => {
    // 50 + 8 = 58, playable on the current string → stay put
    expect(bestFingering(STANDARD_GUITAR_TUNING, 58, 3)).toEqual({
      pitch: 58,
      string: 3,
      fret: 8,
    });
  });

  it("walks the frets of the current string across a chromatic drag", () => {
    for (let semi = 0; semi <= 6; semi++) {
      const f = bestFingering(STANDARD_GUITAR_TUNING, 50 + semi, 3);
      expect(f.string).toBe(3);
      expect(f.fret).toBe(semi);
    }
  });

  it("moves to another string once the current one runs out of frets", () => {
    // 24 frets above the open D string (50) is 74 — out of range there
    const f = bestFingering(STANDARD_GUITAR_TUNING, 79, 3);
    expect(f.fret).toBeLessThanOrEqual(MAX_FRET);
    expect(f.pitch).toBe(79);
    // 79 = E5 = open high E (64) + 15
    expect(f).toEqual({ pitch: 79, string: 0, fret: 15 });
  });

  it("prefers the lowest fret among equal candidates", () => {
    // A3 (57) sits on several strings: E2+17, A2+12, D3+7, G3+2
    const f = bestFingering(STANDARD_GUITAR_TUNING, 57, null);
    expect(f).toEqual({ pitch: 57, string: 2, fret: 2 });
  });

  it("clamps below the instrument range to the lowest open string", () => {
    const f = bestFingering(STANDARD_GUITAR_TUNING, 20, 2);
    expect(f).toEqual({ pitch: 40, string: 5, fret: 0 });
  });

  it("clamps above the instrument range to the highest frettable pitch", () => {
    const f = bestFingering(STANDARD_GUITAR_TUNING, 127, 0);
    expect(f.string).toBe(0);
    expect(f.fret).toBe(MAX_FRET);
    expect(f.pitch).toBe(64 + MAX_FRET);
  });
});

describe("duration snapping", () => {
  it("offers the standard notated values (incl. dots)", () => {
    expect(STANDARD_DURATIONS).toContain(480); // quarter
    expect(STANDARD_DURATIONS).toContain(720); // dotted quarter
    expect(STANDARD_DURATIONS).toContain(1920); // whole
    expect(new Set(STANDARD_DURATIONS).size).toBe(STANDARD_DURATIONS.length);
  });

  it("snaps to the nearest standard value", () => {
    expect(snapDuration(500)).toBe(480);
    expect(snapDuration(700)).toBe(720);
    expect(snapDuration(200)).toBe(180); // 1/16. beats 1/16 (120) and 1/8 (240)
    expect(snapDuration(60)).toBe(60);
    expect(snapDuration(3000)).toBe(2880);
  });

  it("never snaps below the shortest standard value", () => {
    // 32nd notes are the shortest entry in the snap table
    expect(snapDuration(10)).toBe(60);
    expect(snapDuration(0, 60)).toBe(60);
    expect(snapDuration(10)).toBeGreaterThanOrEqual(MIN_NOTE_TICKS);
  });

  it("picks the longest value that fits a clamp", () => {
    expect(maxStandardDuration(1000)).toBe(960);
    expect(maxStandardDuration(720)).toBe(720);
    expect(maxStandardDuration(200)).toBe(180);
    expect(maxStandardDuration(10)).toBe(MIN_NOTE_TICKS);
  });

  it("labels values for the drag preview", () => {
    expect(durationLabel(480)).toBe("1/4");
    expect(durationLabel(720)).toBe("1/4.");
    expect(durationLabel(120)).toBe("1/16");
    expect(durationLabel(1920)).toBe("1/1");
  });
});
