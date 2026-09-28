import type { Tuning } from "../model/index.js";

/**
 * Pure note-placement helpers: where a pitch lives on a fretted instrument
 * and which standard notated rhythm a dragged duration should snap to.
 * No DOM — unit-testable, used by the render engine's direct manipulation.
 */

/** Highest fret accepted for a fretted instrument (24-fret guitars). */
export const MAX_FRET = 24;

/** Shortest writable note span in ticks (a 64th note). */
export const MIN_NOTE_TICKS = 30;

/** Open-string MIDI pitch for a visual string index (0 = highest string). */
export function openPitchForString(tuning: Tuning, stringIndex: number): number {
  const lowestFirst = [...tuning.strings];
  const idx = lowestFirst.length - 1 - Math.min(Math.max(stringIndex, 0), lowestFirst.length - 1);
  return lowestFirst[idx] ?? 60;
}

/** Fret needed on `stringIndex` to sound `pitch` (may fall outside 0..MAX_FRET). */
export function fretForPitch(tuning: Tuning, stringIndex: number, pitch: number): number {
  return pitch - openPitchForString(tuning, stringIndex);
}

export interface Fingering {
  readonly pitch: number;
  readonly string: number;
  readonly fret: number;
}

/**
 * Best (string, fret) for a sounding pitch on a fretted instrument.
 *
 * Prefers the current string when the pitch is playable there (a vertical
 * drag then just walks the frets). Otherwise picks the playable position
 * with the lowest fret — the most economical fingering — breaking ties
 * toward the string nearest the preferred one. Pitches outside the
 * instrument's range clamp to the nearest playable position.
 */
export function bestFingering(
  tuning: Tuning,
  pitch: number,
  preferString: number | null = null,
): Fingering {
  const count = tuning.strings.length;
  if (count === 0) return { pitch, string: 0, fret: 0 };
  const clampFret = (f: number): number => Math.min(MAX_FRET, Math.max(0, f));

  const preferred = preferString === null ? -1 : Math.min(Math.max(preferString, 0), count - 1);
  if (preferred >= 0) {
    const exact = fretForPitch(tuning, preferred, pitch);
    if (exact >= 0 && exact <= MAX_FRET) {
      return { pitch, string: preferred, fret: exact };
    }
  }

  // every exact playable position
  let best: Fingering | null = null;
  for (let s = 0; s < count; s++) {
    const fret = fretForPitch(tuning, s, pitch);
    if (fret < 0 || fret > MAX_FRET) continue;
    const candidate: Fingering = { pitch, string: s, fret };
    if (!best) {
      best = candidate;
      continue;
    }
    if (fret < best.fret) {
      best = candidate;
      continue;
    }
    if (fret === best.fret && preferred >= 0) {
      if (Math.abs(s - preferred) < Math.abs(best.string - preferred)) best = candidate;
    }
  }
  if (best) return best;

  // out of range: clamp to the nearest sounding position (least pitch error)
  let nearest: Fingering | null = null;
  let bestError = Number.POSITIVE_INFINITY;
  for (let s = 0; s < count; s++) {
    const fret = clampFret(fretForPitch(tuning, s, pitch));
    const sounding = openPitchForString(tuning, s) + fret;
    const error = Math.abs(sounding - pitch);
    const closer =
      error < bestError - 1e-9 ||
      (Math.abs(error - bestError) < 1e-9 &&
        preferred >= 0 &&
        nearest !== null &&
        Math.abs(s - preferred) < Math.abs(nearest.string - preferred));
    if (closer || nearest === null) {
      nearest = { pitch: sounding, string: s, fret };
      bestError = Math.min(bestError, error);
    }
  }
  return nearest ?? { pitch, string: 0, fret: 0 };
}

/**
 * Standard notated rhythm values in ticks (whole → 64th, single-dotted
 * variants included). Tuplets are deliberately absent — they need their own
 * entry mode (Phase 1b gap).
 */
export const STANDARD_DURATIONS: readonly number[] = [
  60, 90, 120, 180, 240, 360, 480, 720, 960, 1440, 1920, 2880,
];

/**
 * Nearest standard rhythm value to `ticks`, at least `minTicks`.
 * Pure value-space snap — the engine's duration-edge drag additionally
 * weighs the visual edge position when choosing.
 */
export function snapDuration(ticks: number, minTicks: number = MIN_NOTE_TICKS): number {
  let best = Math.max(minTicks, STANDARD_DURATIONS[0] ?? 60);
  let bestDist = Math.abs(ticks - best);
  for (const value of STANDARD_DURATIONS) {
    const candidate = Math.max(minTicks, value);
    const dist = Math.abs(ticks - candidate);
    if (dist < bestDist) {
      best = candidate;
      bestDist = dist;
    }
  }
  return best;
}

/** Longest notated value that fits in `ticks` (for clamping a drag). */
export function maxStandardDuration(ticks: number): number {
  let best = MIN_NOTE_TICKS;
  for (const value of STANDARD_DURATIONS) {
    if (value <= ticks && value > best) best = value;
  }
  return best;
}

const DURATION_LABELS: Readonly<Record<number, string>> = {
  60: "1/32",
  90: "1/32.",
  120: "1/16",
  180: "1/16.",
  240: "1/8",
  360: "1/8.",
  480: "1/4",
  720: "1/4.",
  960: "1/2",
  1440: "1/2.",
  1920: "1/1",
  2880: "1/1.",
};

/** Short human label for a notated rhythm value ("1/4.", "1/16"…). */
export function durationLabel(ticks: number): string {
  return DURATION_LABELS[ticks] ?? `~${String(Math.round(ticks))}`;
}
