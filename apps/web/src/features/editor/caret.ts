import type { Bar, Note, Rest, Score } from "@sower/core";
import { TICKS_PER_QUARTER, ticksPerBar } from "@sower/core";

/**
 * Keyboard-first caret over the score grid.
 * Coordinates: master bar index, string index (0 = highest), tick within bar.
 * The default editing grid is an eighth note (240 ticks).
 */
export const GRID_TICKS = TICKS_PER_QUARTER / 2;

/** Highest fret the editor accepts (24-fret guitars). */
export const MAX_FRET = 24;

/** Note values available as the persistent entry duration (Guitar-Pro style). */
export type DurationValue = "whole" | "half" | "quarter" | "eighth" | "16th" | "32nd";

/** Duration values in entry-palette order (longest first). */
export const DURATION_VALUES: readonly DurationValue[] = [
  "whole",
  "half",
  "quarter",
  "eighth",
  "16th",
  "32nd",
];

const DURATION_QUARTERS: Record<DurationValue, number> = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 1 / 2,
  "16th": 1 / 4,
  "32nd": 1 / 8,
};

/** Ticks of a note value (optionally dotted) at the model's 480-per-quarter resolution. */
export function durationTicks(value: DurationValue, dotted: boolean): number {
  return Math.round(TICKS_PER_QUARTER * DURATION_QUARTERS[value] * (dotted ? 1.5 : 1));
}

/** Nearest note value for a tick duration (dotted values round to their base). */
export function durationValueOfTicks(ticks: number): DurationValue {
  const quarters = ticks / TICKS_PER_QUARTER;
  if (quarters >= 3) return "whole"; // 4 or 6 (dotted half)
  if (quarters >= 1.5) return "half"; // 2 or 3 (dotted quarter)
  if (quarters >= 0.75) return "quarter"; // 1 or 1.5 (dotted eighth)
  if (quarters >= 0.375) return "eighth";
  if (quarters >= 0.1875) return "16th";
  return "32nd";
}

/** True when the tick duration is dotted (1.5× its base value). */
export function durationIsDotted(ticks: number): boolean {
  return Math.abs(ticks - durationTicks(durationValueOfTicks(ticks), false)) > 0.01;
}

export interface DurationChoice {
  readonly value: DurationValue;
  readonly dotted: boolean;
}

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
  return moveCaretByTicks(score, caret, steps * GRID_TICKS, GRID_TICKS);
}

/**
 * Moves the caret by an exact tick amount (the entry note value) — the
 * cursor follows the selected duration so consecutive values sit side by
 * side (four 16ths advance 120 ticks each) and beam together. At the end of
 * the score it clamps to the last position where `stepTicks` still fits.
 */
export function moveCaretByTicks(
  score: Score,
  caret: Caret,
  deltaTicks: number,
  stepTicks: number = Math.abs(deltaTicks) || GRID_TICKS,
): Caret {
  let barIndex = caret.barIndex;
  let tick = caret.tick + deltaTicks;
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
      const step = Math.min(Math.abs(stepTicks) || GRID_TICKS, capacityOf(score, barIndex));
      tick = Math.max(0, capacityOf(score, barIndex) - step);
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

/** Written rest covering a tick position in the bar (voice 0). */
export function restCovering(bar: Bar, tick: number): Rest | null {
  for (const rest of bar.voices[0]?.rests ?? []) {
    if (rest.start <= tick && tick < rest.start + rest.duration) return rest;
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

