import type { BarId, Note, NoteId, Score, TrackId } from "../model/index.js";
import { TICKS_PER_QUARTER } from "../model/index.js";
/**
 * Event-sourced editing: every modification of a Score is a Command that
 * returns the new Score. Commands are pure functions; undo/redo, versioning,
 * diffs and live-transcription review build on top of this.
 *
 * Invariants a command must preserve:
 *  - never mutates the input score
 *  - never leaves dangling references (all ids must exist in the result)
 */
export type Command =
  | SetNotePitch
  | SetNoteDuration
  | AddNote
  | RemoveNote
  | SetTrackInstrument
  | AddBar
  | RemoveBar
  | SetBarTempo
  | SetTimeSignature;

export interface SetNotePitch {
  readonly type: "setNotePitch";
  readonly trackId: TrackId;
  readonly barId: BarId;
  readonly noteId: NoteId;
  readonly pitch: number;
  readonly fret?: number;
  readonly string?: number;
}

export interface SetNoteDuration {
  readonly type: "setNoteDuration";
  readonly trackId: TrackId;
  readonly barId: BarId;
  readonly noteId: NoteId;
  readonly duration: number;
}

export interface AddNote {
  readonly type: "addNote";
  readonly trackId: TrackId;
  readonly barId: BarId;
  readonly note: {
    readonly pitch: number;
    readonly start: number;
    readonly duration: number;
    readonly velocity?: number;
    readonly string?: number;
    readonly fret?: number;
  };
}

export interface RemoveNote {
  readonly type: "removeNote";
  readonly trackId: TrackId;
  readonly barId: BarId;
  readonly noteId: NoteId;
}

export interface SetTrackInstrument {
  readonly type: "setTrackInstrument";
  readonly trackId: TrackId;
  readonly midiProgram: number;
}

export interface AddBar {
  readonly type: "addBar";
  /** null appends after the last bar; otherwise inserts right after this bar. */
  readonly afterBarId: BarId | null;
  /** Defaults to the preceding bar's signature (or 4/4). */
  readonly timeSignature?: { readonly numerator: number; readonly denominator: number };
}

export interface RemoveBar {
  readonly type: "removeBar";
  readonly barId: BarId;
}

export interface SetBarTempo {
  readonly type: "setBarTempo";
  readonly barId: BarId;
  /** BPM of the notated beat unit; null removes the marker (carries the previous). */
  readonly tempo: number | null;
  /**
   * Ticks of the beat unit the BPM refers to (240 = eighth, 360 = dotted
   * eighth, 480 = quarter…). Omitted keeps the bar's current unit.
   */
  readonly unitTicks?: number | null;
}

export interface SetTimeSignature {
  readonly type: "setTimeSignature";
  readonly barId: BarId;
  readonly numerator: number;
  readonly denominator: number;
}

export interface CommandContext {
  /** Monotonic id generator shared across the editing session. */
  nextNoteId(): NoteId;
  nextBarId(): BarId;
  /** Keeps the allocator ahead of externally-loaded scores (optional). */
  sync?(score: Score): void;
}

export function applyCommand(score: Score, command: Command, ctx: CommandContext): Score {
  switch (command.type) {
    case "setNotePitch":
      return mapNote(score, command.trackId, command.barId, command.noteId, (note) => ({
        ...note,
        pitch: command.pitch,
        fret: command.fret ?? note.fret,
        string: command.string ?? note.string,
      }));
    case "setNoteDuration":
      return mapNote(score, command.trackId, command.barId, command.noteId, (note) => ({
        ...note,
        duration: command.duration,
      }));
    case "addNote": {
      const note = {
        id: ctx.nextNoteId(),
        pitch: command.note.pitch,
        string: command.note.string ?? null,
        fret: command.note.fret ?? null,
        start: command.note.start,
        duration: command.note.duration,
        velocity: command.note.velocity ?? 100,
        articulations: [],
      };
      return mapVoice(score, command.trackId, command.barId, (notes) => [...notes, note]);
    }
    case "removeNote":
      return mapVoice(score, command.trackId, command.barId, (notes) =>
        notes.filter((n) => n.id !== command.noteId),
      );
    case "setTrackInstrument":
      return {
        ...score,
        tracks: score.tracks.map((t) =>
          t.id === command.trackId ? { ...t, midiProgram: command.midiProgram } : t,
        ),
      };
    case "addBar": {
      const afterIndex = command.afterBarId === null
        ? score.bars.length - 1
        : score.bars.findIndex((b) => b.id === command.afterBarId);
      if (afterIndex < -1 || afterIndex >= score.bars.length) {
        throw new Error(`Bar ${String(command.afterBarId)} not found`);
      }
      const previous = score.bars[afterIndex];
      const emptyBar = {
        id: ctx.nextBarId(),
        timeSignature: command.timeSignature ?? previous?.timeSignature ?? { numerator: 4, denominator: 4 },
        keyChange: null,
        tempo: null,
        voices: [{ notes: [] }],
      };
      const bars = [...score.bars];
      bars.splice(afterIndex + 1, 0, emptyBar);
      return { ...score, bars };
    }
    case "removeBar": {
      if (score.bars.length <= 1) {
        throw new Error("Cannot remove the last remaining measure");
      }
      if (!hasBar(score, command.barId)) {
        throw new Error(`Bar ${String(command.barId)} not found`);
      }
      return { ...score, bars: score.bars.filter((b) => b.id !== command.barId) };
    }
    case "setBarTempo": {
      if (command.tempo !== null && (command.tempo < 20 || command.tempo > 400)) {
        throw new Error(`Tempo ${String(command.tempo)} out of range (20-400 BPM)`);
      }
      if (!hasBar(score, command.barId)) {
        throw new Error(`Bar ${String(command.barId)} not found`);
      }
      const existing = score.bars.find((bar) => bar.id === command.barId);
      if (!existing) throw new Error(`Bar ${String(command.barId)} not found`);
      let unitTicks: number | null | undefined;
      if (command.tempo === null) {
        unitTicks = null; // clearing the marker clears its beat unit
      } else if (command.unitTicks !== undefined && command.unitTicks !== null) {
        if (
          !Number.isInteger(command.unitTicks) ||
          command.unitTicks <= 0 ||
          command.unitTicks > TICKS_PER_QUARTER * 8 ||
          command.unitTicks % 30 !== 0
        ) {
          throw new Error(`Invalid tempo unit ticks ${String(command.unitTicks)}`);
        }
        unitTicks = command.unitTicks;
      } else {
        unitTicks = existing.tempoUnit ?? null;
      }
      return {
        ...score,
        bars: score.bars.map((bar) =>
          bar.id === command.barId ? { ...bar, tempo: command.tempo, tempoUnit: unitTicks } : bar,
        ),
      };
    }
    case "setTimeSignature": {
      const { numerator, denominator } = command;
      if (!Number.isInteger(numerator) || numerator < 1 || numerator > 32) {
        throw new Error(`Invalid time signature numerator ${String(numerator)}`);
      }
      if (!Number.isInteger(denominator) || ![2, 4, 8, 16].includes(denominator)) {
        throw new Error(`Invalid time signature denominator ${String(denominator)}`);
      }
      const index = score.bars.findIndex((b) => b.id === command.barId);
      if (index < 0) {
        throw new Error(`Bar ${String(command.barId)} not found`);
      }
      // a signature change applies from this measure onward (standard notation)
      return {
        ...score,
        bars: score.bars.map((bar, i) =>
          i >= index
            ? { ...bar, timeSignature: { numerator, denominator } }
            : bar,
        ),
      };
    }
  }
}

function mapNote(
  score: Score,
  trackId: TrackId,
  barId: BarId,
  noteId: NoteId,
  fn: (note: Note) => Note,
): Score {
  if (!hasNote(score, barId, noteId)) {
    throw new Error(`Note ${String(noteId)} not found in bar ${String(barId)} (track ${String(trackId)})`);
  }
  const bars = score.bars.map((bar) => {
    if (bar.id !== barId) return bar;
    const voices = bar.voices.map((voice, vi) => {
      if (vi !== 0) return voice;
      const notes = voice.notes.map((note) => (note.id === noteId ? fn(note) : note));
      return { notes };
    });
    return { ...bar, voices };
  });
  return { ...score, bars };
}

function mapVoice(
  score: Score,
  trackId: TrackId,
  barId: BarId,
  fn: (notes: readonly Note[]) => readonly Note[],
): Score {
  if (!hasBar(score, barId)) {
    throw new Error(`Bar ${String(barId)} not found (track ${String(trackId)})`);
  }
  const bars = score.bars.map((bar) => {
    if (bar.id !== barId) return bar;
    const voices = bar.voices.map((voice, vi) => (vi === 0 ? { notes: fn(voice.notes) } : voice));
    return { ...bar, voices };
  });
  return { ...score, bars };
}

function hasNote(score: Score, barId: BarId, noteId: NoteId): boolean {
  for (const bar of score.bars) {
    if (bar.id !== barId) continue;
    for (const voice of bar.voices) {
      for (const note of voice.notes) {
        if (note.id === noteId) return true;
      }
    }
  }
  return false;
}

function hasBar(score: Score, barId: BarId): boolean {
  for (const bar of score.bars) {
    if (bar.id === barId) return true;
  }
  return false;
}
