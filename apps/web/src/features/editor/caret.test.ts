import { describe, expect, it } from "vitest";
import type { Score } from "@stdbd/core";
import { TICKS_PER_QUARTER } from "@stdbd/core";
import {
  GRID_TICKS,
  capacityOf,
  createCaret,
  moveCaretByTicks,
  moveCaretHorizontally,
  moveCaretVertically,
  noteAt,
  noteUnderCaret,
  openStringPitch,
} from "./caret";

function makeScore(bars = 2): Score {
  return {
    title: "Test",
    artist: "",
    tracks: [
      {
        id: 1 as never,
        name: "Guitar",
        instrument: "guitar",
        clef: "tabs",
        tuning: { strings: [40, 45, 50, 55, 59, 64] },
        midiProgram: 30,
        volume: 1,
        pan: 0,
        muted: false,
        solo: false,
      },
    ],
    bars: Array.from({ length: bars }, (_, i) => ({
      id: (i + 1) as never,
      timeSignature: { numerator: 4, denominator: 4 },
      keyChange: null,
      tempo: 120,
      voices: [{ notes: [] }],
    })),
  };
}

describe("caret navigation", () => {
  it("moves within a bar by grid steps", () => {
    const score = makeScore();
    const caret = moveCaretHorizontally(score, createCaret(), 3);
    expect(caret.tick).toBe(3 * GRID_TICKS);
    expect(caret.barIndex).toBe(0);
  });

  it("wraps into the next bar at the end", () => {
    const score = makeScore();
    const caret = moveCaretHorizontally(score, createCaret(), 9);
    expect(caret.barIndex).toBe(1);
    expect(caret.tick).toBe(GRID_TICKS);
  });

  it("wraps backwards into the previous bar", () => {
    const score = makeScore();
    const start = { barIndex: 1, stringIndex: 0, tick: 0 };
    const caret = moveCaretHorizontally(score, start, -1);
    expect(caret.barIndex).toBe(0);
    expect(caret.tick).toBe(capacityOf(score, 0) - GRID_TICKS);
  });

  it("clamps at the very end of the score", () => {
    const score = makeScore();
    const end = { barIndex: 1, stringIndex: 0, tick: 1680 };
    const next = moveCaretHorizontally(score, end, 5);
    expect(next.tick).toBe(1680);
  });

  it("moves by exact note-value ticks (16ths land side by side)", () => {
    const score = makeScore();
    const start = { barIndex: 0, stringIndex: 0, tick: 0 };
    let c = moveCaretByTicks(score, start, 120); // a 16th
    expect(c.tick).toBe(120);
    c = moveCaretByTicks(score, c, 120);
    expect(c.tick).toBe(240);
    c = moveCaretByTicks(score, c, 360); // dotted eighth step
    expect(c.tick).toBe(600);
  });

  it("wraps exact tick moves across bars", () => {
    const score = makeScore();
    const nearEnd = { barIndex: 0, stringIndex: 0, tick: 1800 };
    const c = moveCaretByTicks(score, nearEnd, 240);
    expect(c.barIndex).toBe(1);
    expect(c.tick).toBe(120);
  });

  it("up arrow moves to a higher string (lower visual index)", () => {
    const score = makeScore();
    const caret = moveCaretVertically(score, { barIndex: 0, stringIndex: 3, tick: 0 }, -1);
    expect(caret.stringIndex).toBe(2);
    expect(moveCaretVertically(score, caret, 1).stringIndex).toBe(3);
  });

  it("clamps string index at both ends", () => {
    const score = makeScore();
    expect(moveCaretVertically(score, createCaret(), -3).stringIndex).toBe(0);
    const bottom = moveCaretVertically(score, createCaret(), 99);
    expect(bottom.stringIndex).toBe(5);
  });
});

describe("caret helpers", () => {
  it("openStringPitch maps visual index 0 to the highest string", () => {
    const score = makeScore();
    expect(openStringPitch(score, 0)).toBe(64);
    expect(openStringPitch(score, 5)).toBe(40);
  });

  it("capacityOf returns 4/4 bar capacity", () => {
    expect(capacityOf(makeScore(), 0)).toBe(TICKS_PER_QUARTER * 4);
  });
});

describe("note lookup", () => {
  it("finds a note starting at the caret", () => {
    let score = makeScore(1);
    const note = {
      id: 10 as never,
      pitch: 60,
      string: 2,
      fret: 5,
      start: GRID_TICKS,
      duration: GRID_TICKS,
      velocity: 100,
      articulations: [],
    };
    score = {
      ...score,
      bars: [{ ...score.bars[0]!, voices: [{ notes: [note] }] }],
    };
    const caret = { barIndex: 0, stringIndex: 2, tick: GRID_TICKS };
    expect(noteAt(score, caret)?.id).toBe(note.id);
    expect(noteUnderCaret(score, caret)?.id).toBe(note.id);
    expect(noteAt(score, { barIndex: 0, stringIndex: 2, tick: 0 })).toBeNull();
  });

  it("noteUnderCaret finds sustained notes", () => {
    let score = makeScore(1);
    const note = {
      id: 11 as never,
      pitch: 60,
      string: 1,
      fret: 3,
      start: 0,
      duration: TICKS_PER_QUARTER,
      velocity: 100,
      articulations: [],
    };
    score = { ...score, bars: [{ ...score.bars[0]!, voices: [{ notes: [note] }] }] };
    const caret = { barIndex: 0, stringIndex: 1, tick: GRID_TICKS };
    expect(noteAt(score, caret)).toBeNull();
    expect(noteUnderCaret(score, caret)?.id).toBe(note.id);
  });
});
