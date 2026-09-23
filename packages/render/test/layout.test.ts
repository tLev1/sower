import { describe, expect, it } from "vitest";
import type { Score } from "@stdbd/core";
import { STANDARD_GUITAR_TUNING, TICKS_PER_QUARTER } from "@stdbd/core";
import {
  beamGroupSize,
  caretAnchor,
  computeLayout,
  groupIntoBeats,
  positionAt,
} from "../src/engine/layout.js";

function buildScore(): Score {
  const eighth = TICKS_PER_QUARTER / 2;
  const licks: { fret: number; string: number }[][] = [
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
  let noteId = 1;
  const bars = licks.map((lick, barIndex) => ({
    id: (barIndex + 1) as never,
    timeSignature: { numerator: 4, denominator: 4 },
    keyChange: { fifths: 0, mode: "major" as const },
    tempo: barIndex === 0 ? 96 : null,
    voices: [
      {
        notes: lick.map((n, i) => {
          const lowestFirst = STANDARD_GUITAR_TUNING.strings;
          const open = lowestFirst[lowestFirst.length - 1 - n.string] ?? 0;
          return {
            id: noteId++ as never,
            pitch: open + n.fret,
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
    title: "Layout Test",
    artist: "stdBd",
    tracks: [
      {
        id: 1 as never,
        name: "Electric Guitar",
        instrument: "guitar",
        clef: "tabs",
        tuning: STANDARD_GUITAR_TUNING,
        midiProgram: 30,
        volume: 0.9,
        pan: 0,
        muted: false,
        solo: false,
      },
    ],
    bars,
  };
}

describe("groupIntoBeats", () => {
  it("fills gaps with rests and keeps note order", () => {
    const score = buildScore();
    const bar = score.bars[0];
    const notes = bar?.voices[0]?.notes ?? [];
    const beats = bar ? groupIntoBeats(notes, bar) : [];
    expect(beats).toHaveLength(8);
    expect(beats[0]?.isRest).toBe(false);
    expect(beats[0]?.notes[0]?.fret).toBe(0);
  });

  it("produces a rest for an empty bar", () => {
    const score = buildScore();
    const bar = score.bars[0];
    if (!bar) return;
    const beats = groupIntoBeats([], bar);
    expect(beats).toHaveLength(1);
    expect(beats[0]?.isRest).toBe(true);
    expect(beats[0]?.duration).toBe(TICKS_PER_QUARTER * 4);
  });
});

describe("beamGroupSize", () => {
  it("follows standard meter conventions", () => {
    expect(beamGroupSize({ numerator: 4, denominator: 4 })).toBe(4);
    expect(beamGroupSize({ numerator: 3, denominator: 4 })).toBe(3);
    expect(beamGroupSize({ numerator: 2, denominator: 4 })).toBe(2);
    expect(beamGroupSize({ numerator: 6, denominator: 8 })).toBe(3);
    expect(beamGroupSize({ numerator: 12, denominator: 8 })).toBe(3);
  });
});

describe("computeLayout", () => {
  it("lays out beats left to right inside systems", () => {
    const score = buildScore();
    const layout = computeLayout(score, { width: 1200 });
    expect(layout.systems.length).toBeGreaterThan(0);
    for (const system of layout.systems) {
      for (const bar of system.bars) {
        const beats = bar.tracks[0]?.beats ?? [];
        for (let i = 1; i < beats.length; i++) {
          const prev = beats[i - 1];
          const curr = beats[i];
          if (prev && curr) expect(curr.x).toBeGreaterThan(prev.x);
        }
      }
    }
  });

  it("renders both notation and tab staves for fretted tracks", () => {
    const score = buildScore();
    const layout = computeLayout(score, { width: 1200 });
    const bar = layout.systems[0]?.bars[0];
    const tb = bar?.tracks[0];
    if (!tb) return;
    expect(tb.notation).toBe(true);
    expect(tb.tab).toBe(true);
    expect(tb.beats.length).toBeGreaterThan(0);
  });

  it("keeps measures contiguous (shared barlines, no gaps)", () => {
    const score = buildScore();
    const layout = computeLayout(score, { width: 1200 });
    const system = layout.systems[0];
    if (!system) return;
    for (let i = 1; i < system.bars.length; i++) {
      const prev = system.bars[i - 1];
      const curr = system.bars[i];
      if (prev && curr) expect(curr.x0).toBe(prev.x1);
    }
  });

  it("beams eighths in metrical groups (4/4 → groups of 4)", () => {
    const score = buildScore();
    const layout = computeLayout(score, { width: 1200 });
    const beats = layout.systems[0]?.bars[0]?.tracks[0]?.beats ?? [];
    const ids = beats.map((b) => b.beamId);
    // beats 0-3 share a group; beats 4-7 share another
    expect(ids[0]).toBe(ids[1]);
    expect(ids[1]).toBe(ids[2]);
    expect(ids[2]).toBe(ids[3]);
    expect(ids[3]).not.toBe(ids[4]);
    expect(ids[4]).toBe(ids[5]);
    expect(ids[5]).toBe(ids[6]);
    expect(ids[6]).toBe(ids[7]);
  });
});

describe("positionAt", () => {
  const score = buildScore();
  const layout = computeLayout(score, { width: 1200 });

  it("maps a click on a tab string line to that string", () => {
    const bar = layout.systems[0]?.bars[0];
    const tb = bar?.tracks[0];
    if (!bar || !tb) return;
    const beat = tb.beats[2];
    if (!beat) return;
    const y = tb.tabTop + 3 * layout.tabLineGap;
    const pos = positionAt(layout, beat.x, y);
    expect(pos?.barIndex).toBe(bar.index);
    expect(pos?.stringIndex).toBe(3);
  });

  it("returns null stringIndex above the tab staff (notation area)", () => {
    const bar = layout.systems[0]?.bars[0];
    const tb = bar?.tracks[0];
    if (!bar || !tb) return;
    const beat = tb.beats[0];
    if (!beat) return;
    const pos = positionAt(layout, beat.x, tb.staffTop + 2 * layout.staffSpace);
    expect(pos?.stringIndex).toBeNull();
  });
});

describe("caretAnchor", () => {
  const score = buildScore();
  const layout = computeLayout(score, { width: 1200 });

  it("returns an anchor on the requested string line", () => {
    const anchor = caretAnchor(layout, 0, 0, 5);
    expect(anchor).not.toBeNull();
    const tb = layout.systems[0]?.bars[0]?.tracks[0];
    expect(anchor?.y).toBe((tb?.tabTop ?? 0) + 5 * layout.tabLineGap);
    expect(anchor?.x).toBeGreaterThan(0);
  });

  it("places the caret exactly on the first beat column at tick 0", () => {
    const beat = layout.systems[0]?.bars[0]?.tracks[0]?.beats[0];
    const anchor = caretAnchor(layout, 0, 0, 0);
    expect(beat).toBeDefined();
    expect(anchor?.x).toBe(beat?.x);
  });
});
