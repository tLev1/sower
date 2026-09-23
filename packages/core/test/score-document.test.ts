import { describe, expect, it, vi } from "vitest";
import { ScoreDocument, type Score, TICKS_PER_QUARTER } from "../src/index.js";

function makeScore(): Score {
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
    bars: [
      {
        id: 1 as never,
        timeSignature: { numerator: 4, denominator: 4 },
        keyChange: null,
        tempo: 120,
        voices: [{ notes: [] }],
      },
    ],
  };
}

const pitch = (fret: number) => 40 + fret;

describe("ScoreDocument", () => {
  it("never allocates ids that collide with the loaded score", () => {
    const doc = new ScoreDocument({ initialScore: makeScore() });
    doc.execute({ type: "addBar", afterBarId: null });
    const addedBarId = doc.score.bars[1]!.id;
    expect(addedBarId).not.toBe(1 as never);
    expect(doc.score.bars[0]!.id).not.toBe(addedBarId);
    doc.execute({ type: "removeBar", barId: addedBarId });
    expect(doc.score.bars).toHaveLength(1); // exactly one bar removed
  });

  it("re-seeds the allocator after reset (loaded scores keep unique ids)", () => {
    const doc = new ScoreDocument({ initialScore: makeScore() });
    doc.reset(makeScore()); // external load with high ids must be respected
    doc.execute({ type: "addBar", afterBarId: null });
    const added = doc.score.bars[1]!;
    expect(added.id).not.toBe(1 as never);
    doc.execute({ type: "removeBar", barId: added.id });
    expect(doc.score.bars).toHaveLength(1); // exactly one bar removed
  });

  it("applies commands and notifies subscribers", () => {
    const doc = new ScoreDocument({ initialScore: makeScore() });
    const listener = vi.fn();
    doc.subscribe(listener);

    doc.execute({
      type: "addNote",
      trackId: 1 as never,
      barId: 1 as never,
      note: { pitch: pitch(3), start: 0, duration: TICKS_PER_QUARTER, string: 0, fret: 3 },
    });

    expect(doc.score.bars[0]!.voices[0]!.notes).toHaveLength(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("undo restores previous state, redo restores exact ids", () => {
    const doc = new ScoreDocument({ initialScore: makeScore() });
    doc.execute({
      type: "addNote",
      trackId: 1 as never,
      barId: 1 as never,
      note: { pitch: pitch(5), start: 0, duration: TICKS_PER_QUARTER, string: 0, fret: 5 },
    });
    const addedId = doc.score.bars[0]!.voices[0]!.notes[0]!.id;

    expect(doc.undo()).toBe(true);
    expect(doc.score.bars[0]!.voices[0]!.notes).toHaveLength(0);

    expect(doc.redo()).toBe(true);
    expect(doc.score.bars[0]!.voices[0]!.notes[0]!.id).toBe(addedId);
    expect(doc.score.bars[0]!.voices[0]!.notes[0]!.fret).toBe(5);
  });

  it("new edit after undo discards the redo tail", () => {
    const doc = new ScoreDocument({ initialScore: makeScore() });
    doc.execute({
      type: "addNote",
      trackId: 1 as never,
      barId: 1 as never,
      note: { pitch: pitch(1), start: 0, duration: TICKS_PER_QUARTER, string: 0, fret: 1 },
    });
    doc.undo();
    doc.execute({
      type: "addNote",
      trackId: 1 as never,
      barId: 1 as never,
      note: { pitch: pitch(2), start: 0, duration: TICKS_PER_QUARTER, string: 0, fret: 2 },
    });

    expect(doc.canRedo).toBe(false);
    expect(doc.score.bars[0]!.voices[0]!.notes[0]!.fret).toBe(2);
  });

  it("respects maxHistory", () => {
    const doc = new ScoreDocument({ initialScore: makeScore(), maxHistory: 2 });
    for (const fret of [1, 2, 3]) {
      doc.execute({
        type: "addNote",
        trackId: 1 as never,
        barId: 1 as never,
        note: {
          pitch: pitch(fret),
          start: (fret - 1) * TICKS_PER_QUARTER,
          duration: TICKS_PER_QUARTER,
          string: 0,
          fret,
        },
      });
    }
    doc.undo();
    doc.undo();
    expect(doc.canUndo).toBe(false);
    // history fell off the front: two undos land on the initial (empty) score
    expect(doc.score.bars[0]!.voices[0]!.notes).toHaveLength(0);
    expect(doc.redo()).toBe(true);
    // redo lands on the oldest retained snapshot: the score after add2
    const notes = doc.score.bars[0]!.voices[0]!.notes;
    expect(notes).toHaveLength(2);
    expect(notes[0]!.fret).toBe(1);
    expect(notes[1]!.fret).toBe(2);
  });

  it("reset replaces score and clears history", () => {
    const doc = new ScoreDocument({ initialScore: makeScore() });
    doc.execute({
      type: "addNote",
      trackId: 1 as never,
      barId: 1 as never,
      note: { pitch: 60, start: 0, duration: TICKS_PER_QUARTER },
    });
    const fresh = makeScore();
    doc.reset(fresh);

    expect(doc.score).toBe(fresh);
    expect(doc.canUndo).toBe(false);
    expect(doc.canRedo).toBe(false);
  });

  it("unsubscribe stops notifications", () => {
    const doc = new ScoreDocument({ initialScore: makeScore() });
    const listener = vi.fn();
    const off = doc.subscribe(listener);
    off();
    doc.execute({
      type: "addNote",
      trackId: 1 as never,
      barId: 1 as never,
      note: { pitch: 60, start: 0, duration: TICKS_PER_QUARTER },
    });
    expect(listener).not.toHaveBeenCalled();
  });
});
