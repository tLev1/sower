import { describe, expect, it } from "vitest";
import { applyCommand, createIdAllocator, type CommandContext } from "../src/index.js";
import { TICKS_PER_QUARTER, type Score } from "../src/model/index.js";

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
        voices: [
          {
            notes: [
              {
                id: 100 as never,
                pitch: 64,
                string: 0,
                fret: 0,
                start: 0,
                duration: TICKS_PER_QUARTER,
                velocity: 100,
                articulations: [],
              },
            ],
          },
        ],
      },
    ],
  };
}

const ctx: CommandContext = {
  nextNoteId: () => 200 as never,
  nextBarId: () => 300 as never,
};

describe("applyCommand", () => {
  it("setNotePitch changes pitch without mutating the original", () => {
    const score = makeScore();
    const next = applyCommand(score, {
      type: "setNotePitch",
      trackId: 1 as never,
      barId: 1 as never,
      noteId: 100 as never,
      pitch: 67,
      fret: 3,
    }, ctx);

    expect(next).not.toBe(score);
    expect(score.bars[0]!.voices[0]!.notes[0]!.pitch).toBe(64); // original untouched
    expect(next.bars[0]!.voices[0]!.notes[0]!.pitch).toBe(67);
    expect(next.bars[0]!.voices[0]!.notes[0]!.fret).toBe(3);
  });

  it("setNoteDuration changes duration", () => {
    const score = makeScore();
    const next = applyCommand(score, {
      type: "setNoteDuration",
      trackId: 1 as never,
      barId: 1 as never,
      noteId: 100 as never,
      duration: TICKS_PER_QUARTER * 2,
    }, ctx);
    expect(next.bars[0]!.voices[0]!.notes[0]!.duration).toBe(TICKS_PER_QUARTER * 2);
  });

  it("addNote appends with a fresh id", () => {
    const score = makeScore();
    const next = applyCommand(score, {
      type: "addNote",
      trackId: 1 as never,
      barId: 1 as never,
      note: { pitch: 60, start: TICKS_PER_QUARTER, duration: TICKS_PER_QUARTER, string: 1, fret: 5 },
    }, createIdAllocator());
    const notes = next.bars[0]!.voices[0]!.notes;
    expect(notes).toHaveLength(2);
    expect(notes[1]!.id).toBe(1 as never);
  });

  it("removeNote deletes the note", () => {
    const score = makeScore();
    const next = applyCommand(score, {
      type: "removeNote",
      trackId: 1 as never,
      barId: 1 as never,
      noteId: 100 as never,
    }, ctx);
    expect(next.bars[0]!.voices[0]!.notes).toHaveLength(0);
  });

  it("throws when note does not exist (no dangling refs)", () => {
    const score = makeScore();
    expect(() =>
      applyCommand(score, {
        type: "setNotePitch",
        trackId: 1 as never,
        barId: 1 as never,
        noteId: 999 as never,
        pitch: 60,
      }, ctx),
    ).toThrow();
  });

  it("setTrackInstrument updates only the target track", () => {
    const score = makeScore();
    const next = applyCommand(score, {
      type: "setTrackInstrument",
      trackId: 1 as never,
      midiProgram: 33,
    }, ctx);
    expect(next.tracks[0]!.midiProgram).toBe(33);
    expect(score.tracks[0]!.midiProgram).toBe(30);
  });

  it("addBar appends an empty bar inheriting the time signature", () => {
    const score = makeScore();
    const next = applyCommand(score, { type: "addBar", afterBarId: null }, ctx);
    expect(next.bars).toHaveLength(2);
    const added = next.bars[1]!;
    expect(added.id).toBe(300 as never);
    expect(added.timeSignature).toEqual({ numerator: 4, denominator: 4 });
    expect(added.voices[0]!.notes).toHaveLength(0);
    expect(score.bars).toHaveLength(1);
  });

  it("addBar can insert after a specific bar and override the signature", () => {
    const score = makeScore();
    const withSecond = applyCommand(score, { type: "addBar", afterBarId: null }, ctx);
    const next = applyCommand(withSecond, {
      type: "addBar",
      afterBarId: 1 as never,
      timeSignature: { numerator: 3, denominator: 4 },
    }, ctx);
    expect(next.bars).toHaveLength(3);
    expect(next.bars[1]!.timeSignature).toEqual({ numerator: 3, denominator: 4 });
  });

  it("removeBar deletes the bar and refuses to empty the score", () => {
    const score = makeScore();
    expect(() => applyCommand(score, { type: "removeBar", barId: 1 as never }, ctx)).toThrow();
    const withSecond = applyCommand(score, { type: "addBar", afterBarId: null }, ctx);
    const next = applyCommand(withSecond, { type: "removeBar", barId: 300 as never }, ctx);
    expect(next.bars).toHaveLength(1);
    expect(withSecond.bars).toHaveLength(2);
  });

  it("setBarTempo sets and clears the tempo marker", () => {
    const score = makeScore();
    const faster = applyCommand(score, { type: "setBarTempo", barId: 1 as never, tempo: 140 }, ctx);
    expect(faster.bars[0]!.tempo).toBe(140);
    expect(score.bars[0]!.tempo).toBe(120);
    const cleared = applyCommand(faster, { type: "setBarTempo", barId: 1 as never, tempo: null }, ctx);
    expect(cleared.bars[0]!.tempo).toBeNull();
    expect(cleared.bars[0]!.tempoUnit).toBeNull();
    expect(() => applyCommand(faster, { type: "setBarTempo", barId: 1 as never, tempo: 900 }, ctx)).toThrow();
  });

  it("setBarTempo stores the notated beat unit (dotted eighth, quarter…)", () => {
    const score = makeScore();
    const dottedEighth = applyCommand(
      score,
      { type: "setBarTempo", barId: 1 as never, tempo: 85, unitTicks: 360 },
      ctx,
    );
    expect(dottedEighth.bars[0]!.tempo).toBe(85);
    expect(dottedEighth.bars[0]!.tempoUnit).toBe(360);
    // re-commit keeps the existing unit when none is supplied
    const reSet = applyCommand(
      dottedEighth,
      { type: "setBarTempo", barId: 1 as never, tempo: 120 },
      ctx,
    );
    expect(reSet.bars[0]!.tempoUnit).toBe(360);
    expect(() =>
      applyCommand(score, { type: "setBarTempo", barId: 1 as never, tempo: 120, unitTicks: 100 }, ctx),
    ).toThrow();
  });

  it("setTimeSignature applies from the target bar onward", () => {
    const score = makeScore();
    const withSecond = applyCommand(score, { type: "addBar", afterBarId: null }, ctx);
    const next = applyCommand(withSecond, {
      type: "setTimeSignature",
      barId: 1 as never,
      numerator: 3,
      denominator: 4,
    }, ctx);
    expect(next.bars[0]!.timeSignature).toEqual({ numerator: 3, denominator: 4 });
    expect(next.bars[1]!.timeSignature).toEqual({ numerator: 3, denominator: 4 });
    expect(withSecond.bars[0]!.timeSignature).toEqual({ numerator: 4, denominator: 4 });
    expect(() => applyCommand(withSecond, {
      type: "setTimeSignature",
      barId: 1 as never,
      numerator: 7,
      denominator: 5,
    }, ctx)).toThrow();
  });

  it("setTimeSignature stops at the next differing signature (later changes survive)", () => {
    const score = makeScore();
    let nextBarId = 300;
    const seqCtx: CommandContext = {
      nextNoteId: () => 200 as never,
      nextBarId: () => nextBarId++ as never,
    };
    let state = score;
    // bars: 1 (4/4), then three more inherited 4/4
    for (let i = 0; i < 3; i++) {
      state = applyCommand(state, { type: "addBar", afterBarId: null }, seqCtx);
    }
    // a 7/8 change at bar 3
    state = applyCommand(state, {
      type: "setTimeSignature",
      barId: state.bars[2]!.id,
      numerator: 7,
      denominator: 8,
    }, seqCtx);
    // now change bar 1 to 3/4 — must NOT overwrite the 7/8 change at bar 3
    const next = applyCommand(state, {
      type: "setTimeSignature",
      barId: state.bars[0]!.id,
      numerator: 3,
      denominator: 4,
    }, seqCtx);
    expect(next.bars[0]!.timeSignature).toEqual({ numerator: 3, denominator: 4 });
    expect(next.bars[1]!.timeSignature).toEqual({ numerator: 3, denominator: 4 });
    expect(next.bars[2]!.timeSignature).toEqual({ numerator: 7, denominator: 8 });
    expect(next.bars[3]!.timeSignature).toEqual({ numerator: 7, denominator: 8 });
  });
});
