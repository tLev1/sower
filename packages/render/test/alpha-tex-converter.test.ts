import { describe, expect, it } from "vitest";
import { AlphaTabConverter } from "../src/alphatab-adapter/alpha-tex-converter.js";
import { STANDARD_GUITAR_TUNING, type Score } from "@stdbd/core";

function makeGuitarScore(): Score {
  return {
    title: "Test Score",
    artist: "Test Artist",
    tracks: [
      {
        id: 1 as never,
        name: "Guitar",
        instrument: "guitar",
        clef: "tabs",
        tuning: STANDARD_GUITAR_TUNING,
        midiProgram: 30,
        volume: 1,
        pan: 0,
        muted: false,
        solo: false,
      },
    ],
    bars: [
      {
        id: 1 as never,
        timeSignature: { numerator: 4, denominator: 4 },
        keyChange: null,
        tempo: 96,
        voices: [
          {
            notes: [
              { id: 1 as never, pitch: 64, string: 0, fret: 0, start: 0, duration: 240, velocity: 96, articulations: [] },
              { id: 2 as never, pitch: 67, string: 0, fret: 3, start: 240, duration: 240, velocity: 96, articulations: [] },
              { id: 3 as never, pitch: 69, string: 1, fret: 2, start: 480, duration: 960, velocity: 96, articulations: [] },
            ],
          },
        ],
      },
    ],
  };
}

describe("AlphaTabConverter", () => {
  it("produces valid alphaTex header", () => {
    const tex = new AlphaTabConverter().convert(makeGuitarScore());
    expect(tex).toContain('\\title "Test Score"');
    expect(tex).toContain('\\artist "Test Artist"');
    expect(tex).toContain("\\tempo 96");
    expect(tex).toContain("\\ts(4 4)");
  });

  it("maps frets and strings (0-based highest-first -> 1-based top-line-first)", () => {
    const tex = new AlphaTabConverter().convert(makeGuitarScore());
    // string 0 (high E, our 0-based) -> alphaTex string 1
    expect(tex).toContain("0.1");
    expect(tex).toContain("3.1");
    // string 1 -> alphaTex string 2
    expect(tex).toContain("2.2");
  });

  it("fills gaps with rests and emits bar separators", () => {
    const tex = new AlphaTabConverter().convert(makeGuitarScore());
    // note 3 ends at 1440, bar capacity 1920 -> trailing rest of 480 ticks (quarter)
    expect(tex).toContain(":4 r");
    expect(tex).toContain("|");
  });

  it("escapes quotes in metadata", () => {
    const base = makeGuitarScore();
    const score: Score = { ...base, title: 'Weird "Title"' };
    const tex = new AlphaTabConverter().convert(score);
    expect(tex).toContain('\\"');
  });
});
