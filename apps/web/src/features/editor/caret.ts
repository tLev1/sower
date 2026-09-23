import type { Note, Score } from "@stdbd/core";
import { TICKS_PER_QUARTER, ticksPerBar } from "@stdbd/core";

/**
 * Keyboard-first caret over the score grid.
 * Coordinates: master bar index, string index (0 = highest), tick within bar.
 * The default editing grid is an eighth note (240 ticks).
 */
export const GRID_TICKS = TICKS_PER_QUARTER / 2;

/** Highest fret the editor accepts (24-fret guitars). */
export const MAX_FRET = 24;

export interface Caret {
  readonly barIndex: number;
  readonly stringIndex: number;
  readonly tick: number;
}

export function createCaret(): Caret {
  return { barIndex: 0, stringIndex: 0, tick: 0 };
}

export function barCount(score: Score): number {
  return score.bars.length;
}

export function stringCount(score: Score, trackIndex = 0): number {
  const tuning = score.tracks[trackIndex]?.tuning;
  return tuning?.strings.length ?? 4;
}

export function capacityOf(score: Score, barIndex: number): number {
  const bar = score.bars[barIndex];
  if (!bar) return ticksPerBar({ numerator: 4, denominator: 4 });
  return ticksPerBar(bar.timeSignature);
}

/** Open string MIDI pitch for a visual string index (0 = highest). */
export function openStringPitch(score: Score, stringIndex: number, trackIndex = 0): number {
  const tuning = score.tracks[trackIndex]?.tuning;
  if (!tuning) return 60;
  const lowestFirst = [...tuning.strings];
  return lowestFirst[lowestFirst.length - 1 - stringIndex] ?? 60;
}

export function moveCaretHorizontally(score: Score, caret: Caret, steps: number): Caret {
  let barIndex = caret.barIndex;
  let tick = caret.tick + steps * GRID_TICKS;
  while (tick < 0) {
    if (barIndex === 0) {
      tick = 0;
      break;
    }
    barIndex -= 1;
    tick += capacityOf(score, barIndex);
  }
  while (tick >= capacityOf(score, barIndex)) {
    if (barIndex === barCount(score) - 1) {
      tick = capacityOf(score, barIndex) - GRID_TICKS;
      break;
    }
    tick -= capacityOf(score, barIndex);
    barIndex += 1;
  }
  return { ...caret, barIndex, tick: Math.max(0, tick) };
}

export function moveCaretVertically(score: Score, caret: Caret, steps: number): Caret {
  const max = stringCount(score) - 1;
  // negative steps move toward higher-pitched strings = lower visual index
  const stringIndex = Math.min(max, Math.max(0, caret.stringIndex + steps));
  return { ...caret, stringIndex };
}

/** Note on the current string starting exactly at the caret tick (voice 0). */
export function noteAt(score: Score, caret: Caret): Note | null {
  const bar = score.bars[caret.barIndex];
  const notes = bar?.voices[0]?.notes ?? [];
  for (const note of notes) {
    if (note.start === caret.tick && note.string === caret.stringIndex) return note;
  }
  return null;
}

/** Note on the current string that is sounding (covers caret position). */
export function noteUnderCaret(score: Score, caret: Caret): Note | null {
  const bar = score.bars[caret.barIndex];
  const notes = bar?.voices[0]?.notes ?? [];
  for (const note of notes) {
    if (
      note.string === caret.stringIndex &&
      note.start <= caret.tick &&
      caret.tick < note.start + note.duration
    ) {
      return note;
    }
  }
  return null;
}

/** Guitarists think in strings 1..6 from the LOW string; map to visual index. */
export function fromTabString(tabString: number, total: number): number {
  return total - tabString;
}

export function toTabString(stringIndex: number, total: number): number {
  return total - stringIndex;
}

