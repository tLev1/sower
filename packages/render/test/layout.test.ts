import { describe, expect, it } from "vitest";
import type { Note, Score } from "@stdbd/core";
import { STANDARD_GUITAR_TUNING, TICKS_PER_QUARTER } from "@stdbd/core";
import {
  beamGroupSize,
  caretAnchor,
  computeLayout,
  groupIntoBeats,
  playheadAnchorAt,
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

  it("produces a single whole rest for an empty bar", () => {
    const score = buildScore();
    const bar = score.bars[0];
    if (!bar) return;
    const beats = groupIntoBeats([], bar);
    expect(beats).toHaveLength(1);
    expect(beats[0]?.isRest).toBe(true);
    expect(beats[0]?.duration).toBe(TICKS_PER_QUARTER * 4);
  });

  it("decomposes remainders into standard rests (Gould)", () => {
    const score = buildScore();
    const bar = score.bars[0];
    if (!bar) return;
    // a quarter note on beat 1 of 4/4 → quarter + half rest (3 quarters)
    const quarter: Note = {
      id: 500 as never,
      pitch: 64,
      string: 0,
      fret: 0,
      start: 0,
      duration: TICKS_PER_QUARTER,
      velocity: 100,
      articulations: [],
    };
    const seeds = groupIntoBeats([quarter], bar);
    expect(seeds).toHaveLength(3);
    expect(seeds[1]).toMatchObject({ start: TICKS_PER_QUARTER, duration: TICKS_PER_QUARTER, isRest: true });
    expect(seeds[2]).toMatchObject({ start: TICKS_PER_QUARTER * 2, duration: TICKS_PER_QUARTER * 2, isRest: true });
  });

  it("keeps compound-meter rests inside dotted beats (6/8)", () => {
    const score = buildScore();
    const bar = score.bars[0];
    if (!bar) return;
    const compoundBar = { ...bar, timeSignature: { numerator: 6, denominator: 8 } };
    // a quarter note (eighths 1-2) → eighth + quarter + eighth rests
    const seeds = groupIntoBeats([quarterNote()], compoundBar);
    const rests = seeds.filter((s) => s.isRest);
    expect(rests.map((r) => r.duration)).toEqual([240, 480, 240]);
  });

  function quarterNote(): Note {
    return {
      id: 501 as never,
      pitch: 64,
      string: 0,
      fret: 0,
      start: 0,
      duration: TICKS_PER_QUARTER,
      velocity: 100,
      articulations: [],
    };
  }
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

  it("displays a meter change on its mid-system bar", () => {
    const score = buildScore();
    // change bar 2 to 6/8 — with a wide layout both bars share one system
    const changed: Score = {
      ...score,
      bars: score.bars.map((bar, i) =>
        i === 1 ? { ...bar, timeSignature: { numerator: 6, denominator: 8 } } : bar,
      ),
    };
    const layout = computeLayout(changed, { width: 1600 });
    const system = layout.systems[0];
    if (!system) return;
    expect(system.bars.length).toBe(2);
    const changeBar = system.bars[1];
    if (!changeBar) return;
    expect(changeBar.timeSignatureChange).toBe(true);
    expect(changeBar.timeSignature).toEqual({ numerator: 6, denominator: 8 });
    // the change bar reserves lead width before its first beat column
    const firstBeat = changeBar.tracks[0]?.beats[0];
    if (firstBeat) expect(firstBeat.x).toBeGreaterThan(changeBar.x0 + changeBar.tracks[0]!.staffTop * 0);
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

  it("breaks beams between notes more than an octave apart (Gould)", () => {
    const score = buildScore();
    const bar = score.bars[0];
    if (!bar) return;
    // two eighths spanning two octaves (fret 0 low E → fret 12 high E)
    const eighth = TICKS_PER_QUARTER / 2;
    const low: Note = { id: 600 as never, pitch: 40, string: 5, fret: 0, start: 0, duration: eighth, velocity: 100, articulations: [] };
    const high: Note = { id: 601 as never, pitch: 76, string: 0, fret: 12, start: eighth, duration: eighth, velocity: 100, articulations: [] };
    const layout = computeLayout(
      { ...score, bars: [{ ...bar, voices: [{ notes: [low, high] }] }] },
      { width: 1200 },
    );
    const ids = layout.systems[0]?.bars[0]?.tracks[0]?.beats.map((b) => b.beamId) ?? [];
    // the interval is 2 octaves → the beam breaks → no shared beam id
    expect(ids.length).toBeGreaterThanOrEqual(2);
    expect(ids[0] === -1 || ids[0] !== ids[1]).toBe(true);
  });

  it("breaks the beam where it would cross a notehead", () => {
    const score = buildScore();
    const bar = score.bars[0];
    if (!bar) return;
    const eighth = TICKS_PER_QUARTER / 2;
    // contour positions (guitar-written): 5, -1, 5 — stems go down and the
    // beam line sits right on the middle note's head (|0.8| < clearance)
    const a: Note = { id: 610 as never, pitch: 67, string: 1, fret: 8, start: 0, duration: eighth, velocity: 100, articulations: [] };
    const b: Note = { id: 611 as never, pitch: 57, string: 2, fret: 2, start: eighth, duration: eighth, velocity: 100, articulations: [] };
    const c: Note = { id: 612 as never, pitch: 67, string: 1, fret: 8, start: 2 * eighth, duration: eighth, velocity: 100, articulations: [] };
    const layout = computeLayout(
      { ...score, bars: [{ ...bar, voices: [{ notes: [a, b, c] }] }] },
      { width: 1200 },
    );
    const ids = layout.systems[0]?.bars[0]?.tracks[0]?.beats.map((x) => x.beamId) ?? [];
    // a single beam across all three would collide with the middle head
    const allTogether = ids[0] !== -1 && ids[0] === ids[1] && ids[1] === ids[2];
    expect(allTogether).toBe(false);
  });

  it("moves the playhead continuously across the barline", () => {
    const score = buildScore();
    const layout = computeLayout(score, { width: 1200 });
    const barStart2 = TICKS_PER_QUARTER * 4; // bar 2 starts at abs tick 1920
    const before = playheadAnchorAt(layout, barStart2 - TICKS_PER_QUARTER / 16);
    const at = playheadAnchorAt(layout, barStart2);
    const after = playheadAnchorAt(layout, barStart2 + TICKS_PER_QUARTER / 16);
    expect(before).not.toBeNull();
    expect(at).not.toBeNull();
    expect(after).not.toBeNull();
    // around the boundary the x must keep moving forward, no freeze/teleport:
    // x(after) - x(before) should be a fraction of a beat width, same direction
    const span = (at?.x ?? 0) - (before?.x ?? 0);
    const span2 = (after?.x ?? 0) - (at?.x ?? 0);
    expect(span).toBeGreaterThan(0);
    expect(span2).toBeGreaterThan(0);
    expect(Math.abs(span)).toBeLessThan(TICKS_PER_QUARTER);
  });

  it("clamps the playhead to the track ends", () => {
    const score = buildScore();
    const layout = computeLayout(score, { width: 1200 });
    const total = TICKS_PER_QUARTER * 4 * score.bars.length;
    const end = playheadAnchorAt(layout, total + 10000);
    const start = playheadAnchorAt(layout, -100);
    expect(end).not.toBeNull();
    expect(start).not.toBeNull();
    expect(end?.x).toBeGreaterThanOrEqual((start?.x ?? 0));
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

  it("interpolates the click tick between beat columns (rests stay writable)", () => {
    const bar = layout.systems[0]?.bars[0];
    const tb = bar?.tracks[0];
    if (!bar || !tb) return;
    const b0 = tb.beats[0];
    const b1 = tb.beats[1];
    if (!b0 || !b1) return;
    const y = tb.tabTop + 2 * layout.tabLineGap;
    // halfway between two eighth columns → the tick in between, not a column start
    const mid = positionAt(layout, (b0.x + b1.x) / 2, y);
    expect(mid?.tick).toBeGreaterThan(b0.start);
    expect(mid?.tick).toBeLessThan(b1.start);
    // exact column centers still map exactly
    expect(positionAt(layout, b1.x, y)?.tick).toBe(b1.start);
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
