import type { Articulation, BarId, Note, NoteId, Rest, Score, TrackId } from "../model/index.js";
import { TICKS_PER_QUARTER, ticksPerBar } from "../model/index.js";
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
  | SetTimeSignature
  | AddRest
  | SetRestDuration
  | ToggleNoteArticulation;

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

export interface AddRest {
  readonly type: "addRest";
  readonly trackId: TrackId;
  readonly barId: BarId;
  readonly rest: {
    readonly start: number;
    readonly duration: number;
  };
}

export interface SetRestDuration {
  readonly type: "setRestDuration";
  readonly trackId: TrackId;
  readonly barId: BarId;
  readonly restId: NoteId;
  readonly duration: number;
}

/** Toggles a simple (parameterless) articulation on a written note. */
export interface ToggleNoteArticulation {
  readonly type: "toggleNoteArticulation";
  readonly trackId: TrackId;
  readonly barId: BarId;
  readonly noteId: NoteId;
  readonly articulation: "palmMute" | "staccato" | "letRing" | "ghost" | "accent";
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
      return mapVoice(score, command.trackId, command.barId, (notes, rests) => {
        const target = notes.find((n) => n.id === command.noteId);
        if (!target) {
          throw new Error(
            `Note ${String(command.noteId)} not found in bar ${String(command.barId)} (track ${String(command.trackId)})`,
          );
        }
        return [
          notes.map((note) =>
            note.id === command.noteId ? { ...note, duration: command.duration } : note,
          ),
          // a lengthened note takes over the rests it covers; a shortened one
          // simply leaves a gap the measure fills with new rests
          carveRests(rests, target.start, target.start + command.duration),
        ];
      });
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
      return mapVoice(score, command.trackId, command.barId, (notes, rests) => [
        [...notes, note],
        carveRests(rests, note.start, note.start + note.duration),
      ]);
    }
    case "removeNote":
      return mapVoice(score, command.trackId, command.barId, (notes, rests) => [
        notes.filter((n) => n.id !== command.noteId),
        rests,
      ]);
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
      // a signature change applies from this measure UNTIL the next differing
      // signature — later meter changes are preserved (standard notation)
      const current = score.bars[index]?.timeSignature;
      let last = index;
      for (let j = index + 1; j < score.bars.length; j++) {
        const next = score.bars[j]?.timeSignature;
        if (next && current && (next.numerator !== current.numerator || next.denominator !== current.denominator)) break;
        last = j;
      }
      return {
        ...score,
        bars: score.bars.map((bar, i) =>
          i >= index && i <= last
            ? { ...bar, timeSignature: { numerator, denominator } }
            : bar,
        ),
      };
    }
    case "addRest": {
      const { start } = command.rest;
      if (!Number.isInteger(start) || start < 0) {
        throw new Error(`Invalid rest start ${String(start)}`);
      }
      if (!Number.isInteger(command.rest.duration) || command.rest.duration < 30) {
        throw new Error(`Invalid rest duration ${String(command.rest.duration)}`);
      }
      const restBar = score.bars.find((b) => b.id === command.barId);
      const capacity = restBar
        ? ticksPerBar(restBar.timeSignature)
        : command.rest.start + command.rest.duration;
      const duration = Math.min(command.rest.duration, Math.max(30, capacity - start));
      // MuseScore overwrite semantics: the rest takes the time it covers —
      // notes starting inside it are replaced, edge notes are trimmed
      return mapVoice(score, command.trackId, command.barId, (notes, rests) => {
        const end = start + duration;
        const keptNotes: Note[] = [];
        for (const note of notes) {
          const noteEnd = note.start + note.duration;
          if (note.start >= start && note.start < end) continue; // starts inside → replaced
          if (note.start < start && noteEnd > start) {
            const trimmed = start - note.start;
            if (trimmed >= 30) keptNotes.push({ ...note, duration: trimmed });
            continue;
          }
          keptNotes.push(note);
        }
        return [
          keptNotes,
          [...carveRests(rests, start, end), { id: ctx.nextNoteId(), start, duration }],
        ];
      });
    }
    case "setRestDuration": {
      if (!Number.isInteger(command.duration) || command.duration < 30) {
        throw new Error(`Invalid rest duration ${String(command.duration)}`);
      }
      const targetBar = score.bars.find((b) => b.id === command.barId);
      const capacity = targetBar ? ticksPerBar(targetBar.timeSignature) : Number.POSITIVE_INFINITY;
      return mapVoice(score, command.trackId, command.barId, (notes, rests) => {
        const target = rests.find((r) => r.id === command.restId);
        if (!target) {
          throw new Error(
            `Rest ${String(command.restId)} not found in bar ${String(command.barId)} (track ${String(command.trackId)})`,
          );
        }
        // a rest is empty time: clamp to the next written event (and the bar)
        // so editing one never changes the notes after it
        let limit = capacity - target.start;
        for (const n of notes) {
          if (n.start >= target.start) limit = Math.min(limit, n.start - target.start);
        }
        for (const r of rests) {
          if (r.id !== command.restId && r.start >= target.start) {
            limit = Math.min(limit, r.start - target.start);
          }
        }
        const duration = Math.max(30, Math.min(command.duration, limit));
        return [notes, rests.map((r) => (r.id === command.restId ? { ...r, duration } : r))];
      });
    }
    case "toggleNoteArticulation":
      return mapNote(score, command.trackId, command.barId, command.noteId, (note) => {
        const present = note.articulations.some((a) => a.kind === command.articulation);
        return {
          ...note,
          articulations: present
            ? note.articulations.filter((a) => a.kind !== command.articulation)
            : [...note.articulations, articulationOf(command.articulation)],
        };
      });
  }
}

function articulationOf(kind: ToggleNoteArticulation["articulation"]): Articulation {
  switch (kind) {
    case "palmMute":
      return { kind: "palmMute" };
    case "staccato":
      return { kind: "staccato" };
    case "letRing":
      return { kind: "letRing" };
    case "ghost":
      return { kind: "ghost" };
    case "accent":
      return { kind: "accent" };
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
      return { ...voice, notes };
    });
    return { ...bar, voices };
  });
  return { ...score, bars };
}

function mapVoice(
  score: Score,
  trackId: TrackId,
  barId: BarId,
  fn: (notes: readonly Note[], rests: readonly Rest[]) => readonly [readonly Note[], readonly Rest[]],
): Score {
  if (!hasBar(score, barId)) {
    throw new Error(`Bar ${String(barId)} not found (track ${String(trackId)})`);
  }
  const bars = score.bars.map((bar) => {
    if (bar.id !== barId) return bar;
    const voices = bar.voices.map((voice, vi) => {
      if (vi !== 0) return voice;
      const [notes, rests] = fn(voice.notes, voice.rests ?? []);
      return { ...voice, notes, rests };
    });
    return { ...bar, voices };
  });
  return { ...score, bars };
}

/**
 * Notes own their time: any written rest overlapping [start, end) is
 * trimmed to the edges of the span or removed (MuseScore overwrite
 * semantics — entering content replaces the rests it covers).
 */
function carveRests(rests: readonly Rest[], start: number, end: number): readonly Rest[] {
  const out: Rest[] = [];
  for (const rest of rests) {
    const restEnd = rest.start + rest.duration;
    if (restEnd <= start || rest.start >= end) {
      out.push(rest);
      continue;
    }
    if (rest.start < start && restEnd > start) {
      out.push({ ...rest, duration: start - rest.start });
    }
    if (restEnd > end && rest.start < end) {
      out.push({ ...rest, start: end, duration: restEnd - end });
    }
  }
  return out;
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
