import type { Score } from "@sower/core";
import { STANDARD_GUITAR_TUNING, TICKS_PER_QUARTER } from "@sower/core";

/**
 * Minimal demo score: one guitar track, two bars of an E minor pentatonic run.
 * This will be replaced by the real document store later; it exists to prove
 * the core model -> converter -> renderer pipeline end to end.
 */
export function buildDemoScore(): Score {
  const quarter = TICKS_PER_QUARTER;
  const eighth = quarter / 2;

  const licks: { fret: number; string: number }[][] = [
    // Bar 1: E minor pentatonic ascending, open position
    // strings are visual (0 = high E): E G | B D | G A | D E
    [
      { fret: 0, string: 0 },
      { fret: 3, string: 0 },
      { fret: 0, string: 1 },
      { fret: 3, string: 1 },
      { fret: 0, string: 2 },
      { fret: 2, string: 2 },
      { fret: 0, string: 3 },
      { fret: 2, string: 3 },
    ],
    // Bar 2: descending resolution — all E minor pentatonic tones
    [
      { fret: 2, string: 3 },
      { fret: 0, string: 3 },
      { fret: 2, string: 2 },
      { fret: 0, string: 2 },
      { fret: 3, string: 1 },
      { fret: 0, string: 1 },
      { fret: 3, string: 0 },
      { fret: 0, string: 0 },
    ],
  ];

  let noteId = 1 as never;
  const openStringMidi = (stringIndex: number): number => {
    // string 0 = high E (index 5 in lowest-first array)
    const lowestFirst = STANDARD_GUITAR_TUNING.strings;
    return lowestFirst[lowestFirst.length - 1 - stringIndex] ?? 0;
  };

  const bars = licks.map((lick, barIndex) => ({
    id: (barIndex + 1) as never,
    timeSignature: { numerator: 4, denominator: 4 },
    keyChange: { fifths: 0, mode: "major" as const },
    tempo: barIndex === 0 ? 96 : null,
    voices: [
      {
        notes: lick.map((n, i) => {
          const pitch = openStringMidi(n.string) + n.fret;
          return {
            id: noteId++ as never,
            pitch,
            string: n.string,
            fret: n.fret,
            start: i * eighth,
            duration: eighth,
            velocity: 96,
            articulations: [],
          };
        }),
      },
    ],
  }));

  return {
    title: "Em Pentatonic Warmup",
    artist: "Sower demo",
    tracks: [
      {
        id: 1 as never,
        name: "Electric Guitar",
        instrument: "guitar",
        clef: "tabs",
        tuning: STANDARD_GUITAR_TUNING,
        midiProgram: 30, // overdriven guitar
        volume: 0.9,
        pan: 0,
        muted: false,
        solo: false,
      },
    ],
    bars,
  };
}

export const demoScore: Score = buildDemoScore();
