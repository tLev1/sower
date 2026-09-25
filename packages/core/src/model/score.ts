/**
 * Core score model.
 *
 * PURE domain: no DOM, no React, no audio, no I/O.
 * Everything is plain immutable-friendly data; editing happens
 * exclusively through Commands (see commands/).
 */

export type InstrumentFamily = "guitar" | "bass" | "piano" | "drums" | "violin" | "vocal" | "other";

export type Clef = "g2" | "f4" | "c3" | "c4" | "percussion" | "tabs";

export interface Tuning {
  /** MIDI notes of open strings, from lowest to highest string. */
  readonly strings: readonly number[];
}

export const STANDARD_GUITAR_TUNING: Tuning = { strings: [40, 45, 50, 55, 59, 64] };
export const STANDARD_BASS_TUNING: Tuning = { strings: [28, 33, 38, 43] };

export interface Track {
  readonly id: TrackId;
  readonly name: string;
  readonly instrument: InstrumentFamily;
  readonly clef: Clef;
  readonly tuning: Tuning | null;
  /** MIDI program number (General MIDI) used for playback v1. */
  readonly midiProgram: number;
  readonly volume: number; // 0..1
  readonly pan: number; // -1..1
  readonly muted: boolean;
  readonly solo: boolean;
}

declare const brand: unique symbol;
export type TrackId = number & { readonly [brand]: "TrackId" };
export type BarId = number & { readonly [brand]: "BarId" };
export type NoteId = number & { readonly [brand]: "NoteId" };

export interface Voice {
  readonly notes: readonly Note[];
  /**
   * User-written rests with exact values (the measure auto-fills the gaps
   * around them). Optional — legacy scores simply have none.
   */
  readonly rests?: readonly Rest[];
}

/** A written rest: silence of an exact notated length at a position. */
export interface Rest {
  /** Shares the NoteId sequence (voice items are one id space). */
  readonly id: NoteId;
  /** Start position within the bar, in ticks. */
  readonly start: number;
  readonly duration: number;
}

export interface Note {
  readonly id: NoteId;
  /** MIDI note number, 0..127. Drums use GM percussion map values. */
  readonly pitch: number;
  readonly string: number | null; // 0-based string index for fretted instruments
  readonly fret: number | null;
  /** Start position within the bar, in ticks (tick resolution: see TICKS_PER_QUARTER). */
  readonly start: number;
  readonly duration: number;
  readonly velocity: number; // 0..127
  readonly articulations: readonly Articulation[];
}

export type Articulation =
  | { readonly kind: "palmMute" }
  | { readonly kind: "letRing" }
  | { readonly kind: "hammerOn" }
  | { readonly kind: "pullOff" }
  | { readonly kind: "slide"; readonly targetFret: number }
  | { readonly kind: "bend"; readonly semitones: number }
  | { readonly kind: "vibrato" }
  | { readonly kind: "harmonic"; readonly type: "natural" | "artificial" }
  | { readonly kind: "ghost" }
  | { readonly kind: "accent" }
  | { readonly kind: "staccato" }
  | { readonly kind: "tie" };

export interface Bar {
  readonly id: BarId;
  readonly timeSignature: { readonly numerator: number; readonly denominator: number };
  /** Optional key signature change at this bar, e.g. { fifths: 2, mode: "major" }. */
  readonly keyChange: { readonly fifths: number; readonly mode: "major" | "minor" } | null;
  /** BPM of the notated beat unit; null = carry previous. */
  readonly tempo: number | null;
  /**
   * Ticks of the beat unit the tempo refers to (e.g. 240 = ♪=bpm, 360 = ♪.=bpm,
   * 480 = ♩=bpm). null/undefined = quarter note (legacy scores default here).
   */
  readonly tempoUnit?: number | null;
  readonly voices: readonly Voice[];
}

export interface Score {
  readonly title: string;
  readonly artist: string;
  readonly tracks: readonly Track[];
  readonly bars: readonly Bar[];
}

/** Smallest rhythmic unit the model can express: 480 ticks per quarter note. */
export const TICKS_PER_QUARTER = 480;

export function ticksPerBar(timeSignature: { numerator: number; denominator: number }): number {
  // e.g. 4/4 -> 4 * (480 * 4 / 4) = 1920; 6/8 -> 6 * (480 * 4 / 8) = 1440
  return timeSignature.numerator * ((TICKS_PER_QUARTER * 4) / timeSignature.denominator);
}
