import type { BarId, Note, NoteId, Score, TrackId } from "../model/index.js";

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
  | SetTrackInstrument;

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

export interface CommandContext {
  /** Monotonic id generator shared across the editing session. */
  nextNoteId(): NoteId;
  nextBarId(): BarId;
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
