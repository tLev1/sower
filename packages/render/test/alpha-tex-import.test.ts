import { describe, expect, it } from "vitest";
import * as alphaTab from "@coderline/alphatab";
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

function parse(tex: string): {
  score: alphaTab.model.Score;
  diagnostics: string[];
} {
  const importer = new alphaTab.importer.AlphaTexImporter();
  importer.initFromString(tex, new alphaTab.Settings());
  let score: alphaTab.model.Score;
  try {
    score = importer.readScore();
  } catch {
    const all = [
      ...importer.lexerDiagnostics,
      ...importer.parserDiagnostics,
      ...importer.semanticDiagnostics,
    ].map((d) => JSON.stringify(d));
    throw new Error(`alphaTex parse failed:\n${all.join("\n")}\n>> ${tex}`);
  }
  const diagnostics = [
    ...importer.lexerDiagnostics,
    ...importer.parserDiagnostics,
    ...importer.semanticDiagnostics,
  ].map((d) => JSON.stringify(d));
  return { score, diagnostics };
}

describe("alphaTex output parses with alphaTab's importer", () => {
  it("parses the demo score without diagnostics", () => {
    const tex = new AlphaTabConverter().convert(makeGuitarScore());
    const { score, diagnostics } = parse(tex);
    expect(diagnostics, diagnostics.join(" | ") + " >> " + tex).toEqual([]);
    expect(score.title).toBe("Test Score");
    expect(score.masterBars).toHaveLength(1);
    expect(score.masterBars[0]!.timeSignatureNumerator).toBe(4);
  });

  it("round-trips notes onto the correct tab strings", () => {
    const tex = new AlphaTabConverter().convert(makeGuitarScore());
    const { score, diagnostics } = parse(tex);
    expect(diagnostics, diagnostics.join(" | ") + " >> " + tex).toEqual([]);
    const beats = score.tracks[0]!.staves[0]!.bars[0]!.voices[0]!.beats;
    // 3 note beats + trailing quarter rest (bar capacity fill)
    expect(beats).toHaveLength(4);
    expect(beats[0]!.notes[0]!.fret).toBe(0);
    expect(beats[0]!.notes[0]!.string).toBe(6); // model: 1 = lowest, so high E = 6
    expect(beats[0]!.notes[0]!.realValue).toBe(64); // E4 sounding pitch
    expect(beats[1]!.notes[0]!.fret).toBe(3);
    expect(beats[1]!.notes[0]!.realValue).toBe(67);
    expect(beats[2]!.notes[0]!.string).toBe(5);
    expect(beats[3]!.isRest).toBe(true);
  });

  it("groups simultaneous notes into a single chord beat", () => {
    const base = makeGuitarScore();
    const chordScore: Score = {
      ...base,
      bars: [
        {
          ...base.bars[0]!,
          voices: [
            {
              notes: [
                { id: 1 as never, pitch: 64, string: 0, fret: 0, start: 0, duration: 480, velocity: 96, articulations: [] },
                { id: 2 as never, pitch: 71, string: 1, fret: 3, start: 0, duration: 480, velocity: 96, articulations: [] },
              ],
            },
          ],
        },
      ],
    };
    const tex = new AlphaTabConverter().convert(chordScore);
    expect(tex).toContain("(0.1 3.2)");
    const { score, diagnostics } = parse(tex);
    expect(diagnostics, diagnostics.join(" | ") + " >> " + tex).toEqual([]);
    const beats = score.tracks[0]!.staves[0]!.bars[0]!.voices[0]!.beats;
    expect(beats).toHaveLength(2); // chord + trailing rest fill
    expect(beats[0]!.notes).toHaveLength(2);
  });

  it("parses a multi-bar demo score", () => {
    const base = makeGuitarScore();
    const secondBar = {
      ...base.bars[0]!,
      id: 2 as never,
      tempo: null,
      voices: [
        {
          notes: [
            { id: 11 as never, pitch: 67, string: 0, fret: 3, start: 0, duration: 480, velocity: 96, articulations: [] },
            { id: 12 as never, pitch: 64, string: 0, fret: 0, start: 480, duration: 480, velocity: 96, articulations: [] },
          ],
        },
      ],
    };
    const demoScore: Score = { ...base, bars: [base.bars[0]!, secondBar] };
    const tex = new AlphaTabConverter().convert(demoScore);
    const { score, diagnostics } = parse(tex);
    expect(diagnostics, diagnostics.join(" | ") + " >> " + tex).toEqual([]);
    expect(score.masterBars).toHaveLength(2);
    const beats = score.tracks[0]!.staves[0]!.bars[0]!.voices[0]!.beats;
    expect(beats).toHaveLength(4);
  });
});


