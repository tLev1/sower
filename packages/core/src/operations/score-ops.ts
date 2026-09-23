import type { Bar, Score } from "../model/index.js";
import { ticksPerBar } from "../model/index.js";

/**
 * Linear id sequence for editing sessions. Seeded above the ids of the
 * current score (and re-seeded on reset) so allocated ids never collide
 * with externally-loaded data.
 */
export interface IdAllocator {
  nextNoteId(): never;
  nextBarId(): never;
  sync(score: Score): void;
}

export function createIdAllocator(score?: Score): IdAllocator {
  let nextNote = maxNoteId(score) + 1;
  let nextBar = maxBarId(score) + 1;
  return {
    nextNoteId: () => nextNote++ as never,
    nextBarId: () => nextBar++ as never,
    sync: (s: Score): void => {
      nextNote = Math.max(nextNote, maxNoteId(s) + 1);
      nextBar = Math.max(nextBar, maxBarId(s) + 1);
    },
  };
}

function maxBarId(score: Score | undefined): number {
  let max = 0;
  if (!score) return max;
  for (const bar of score.bars) {
    if (bar.id > max) max = bar.id;
  }
  return max;
}

function maxNoteId(score: Score | undefined): number {
  let max = 0;
  if (!score) return max;
  for (const bar of score.bars) {
    for (const voice of bar.voices) {
      for (const note of voice.notes) {
        if (note.id > max) max = note.id;
      }
    }
  }
  return max;
}

/** Effective tempo at a bar index, resolving null (carry previous). */
export function tempoAtBar(score: Score, barIndex: number): number {
  let tempo = 120;
  for (let i = 0; i <= barIndex && i < score.bars.length; i++) {
    const t = score.bars[i]?.tempo;
    if (t !== null && t !== undefined) tempo = t;
  }
  return tempo;
}

/** Total play time (seconds) of a bar index range — used by playback & practice tools. */
export function barStartTime(score: Score, barIndex: number): number {
  let seconds = 0;
  for (let i = 0; i < barIndex && i < score.bars.length; i++) {
    const bar = score.bars[i];
    if (!bar) continue;
    const bpm = tempoAtBar(score, i);
    seconds += (60 / bpm) * (bar.timeSignature.numerator * (4 / bar.timeSignature.denominator));
  }
  return seconds;
}

export function validateBar(bar: Bar): string[] {
  const errors: string[] = [];
  const capacity = ticksPerBar(bar.timeSignature);
  for (const voice of bar.voices) {
    for (const note of voice.notes) {
      const id = String(note.id);
      if (note.start < 0 || note.start + note.duration > capacity) {
        errors.push(`Note ${id} exceeds bar bounds`);
      }
      if (note.duration <= 0) errors.push(`Note ${id} has non-positive duration`);
      if (note.pitch < 0 || note.pitch > 127) errors.push(`Note ${id} pitch out of range`);
    }
  }
  return errors;
}
