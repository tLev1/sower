import { MIN_NOTE_TICKS, maxStandardDuration, snapDuration } from "./fingering.js";
import { TICKS_PER_QUARTER } from "../model/index.js";

/**
 * Hum / sing correction: turns detected sung notes (seconds + MIDI) into
 * notated note specs (ticks + pitch) at a score position. Pure — the editor
 * feeds the result to `addNote` / `setNotePitch`.
 */

export interface HumNoteTiming {
  /** MIDI note number (already rounded to a semitone by the detector). */
  readonly midi: number;
  readonly startSec: number;
  readonly endSec: number;
}

export interface QuantizedNote {
  readonly pitch: number;
  /** Tick offset from the entry point (`fromTick`). */
  readonly start: number;
  readonly duration: number;
}

export interface HumQuantizeOptions {
  /** Quarter-note BPM at the entry point (seconds → ticks). */
  readonly quarterBpm: number;
  /** Grid the note starts snap to, in ticks (the entry note value). */
  readonly gridTicks: number;
  /** Tick offset the first note is written at (default 0). */
  readonly fromTick?: number;
  /** Hard cap on how many notes to produce (safety for long captures). */
  readonly maxNotes?: number;
}

/**
 * Quantises a sung phrase onto the notated grid.
 *
 * Starts snap to `gridTicks` (the entry note value) so a hummed phrase lands
 * on the beats the caret would type. Durations follow the gaps between
 * onsets, clamped so a note never runs into the next one and snapped to the
 * standard rhythm values (the same snap the duration-edge drag uses).
 */
export function quantizeHumNotes(
  notes: readonly HumNoteTiming[],
  options: HumQuantizeOptions,
): QuantizedNote[] {
  const grid = Math.max(1, Math.round(options.gridTicks));
  const fromTick = options.fromTick ?? 0;
  const maxNotes = options.maxNotes ?? 64;
  const bpm = options.quarterBpm > 0 ? options.quarterBpm : 120;
  const ticksPerSec = (bpm / 60) * TICKS_PER_QUARTER;

  const tickOf = (sec: number): number =>
    fromTick + Math.round((sec * ticksPerSec) / grid) * grid;

  const out: QuantizedNote[] = [];
  for (let i = 0; i < notes.length && out.length < maxNotes; i++) {
    const note = notes[i];
    if (!note) continue;
    const start = tickOf(note.startSec);
    // two onsets that quantise to the same tick collapse into one note
    const previous = out[out.length - 1];
    if (previous && start <= previous.start) continue;

    const next = notes[i + 1];
    const limit = next ? Math.max(grid, tickOf(next.startSec) - start) : Math.max(grid, tickOf(note.endSec) - start);
    const snapped = snapDuration(Math.max(grid, limit), Math.min(grid, MIN_NOTE_TICKS));
    const duration = snapped <= limit ? snapped : Math.max(grid, maxStandardDuration(limit));
    out.push({ pitch: note.midi, start, duration: Math.max(Math.min(grid, MIN_NOTE_TICKS), duration) });
  }
  return out;
}

/**
 * The single pitch a hummed "correction" should write: the median MIDI note
 * of the capture, or null when nothing usable was sung.
 */
export function humCorrectionPitch(notes: readonly HumNoteTiming[]): number | null {
  if (notes.length === 0) return null;
  const midis = notes.map((n) => n.midi).sort((a, b) => a - b);
  return midis[Math.floor(midis.length / 2)] ?? null;
}
