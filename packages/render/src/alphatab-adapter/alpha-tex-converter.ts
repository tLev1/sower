import type { Note, Score, Track } from "@stdbd/core";
import { TICKS_PER_QUARTER } from "@stdbd/core";

/**
 * Converts our pure core Score into alphaTex — alphaTab's text markup.
 * alphaTex is stable across alphaTab versions (unlike constructing the model
 * directly) and this class is fully unit-testable without a DOM.
 */
export class AlphaTabConverter {
  convert(score: Score): string {
    const parts: string[] = [];
    parts.push(`\\title "${escapeTex(score.title)}"`);
    if (score.artist) parts.push(`\\artist "${escapeTex(score.artist)}"`);
    const tempo = score.bars.find((b) => b.tempo !== null)?.tempo ?? 120;
    parts.push(`\\tempo ${tempo}`);
    const firstSignature = score.bars[0]?.timeSignature;
    if (firstSignature) {
      parts.push(`\\ts(${firstSignature.numerator} ${firstSignature.denominator})`);
    }

    for (const track of score.tracks) {
      if (score.tracks.length > 1) {
        parts.push(`\\track "${escapeTex(track.name)}"`);
      }
      parts.push(this.trackBarsToTex(track, score));
    }
    return parts.join(" ");
  }

  private trackBarsToTex(track: Track, score: Score): string {
    const bars: string[] = [];

    for (const bar of score.bars) {
      const notes = bar.voices[0]?.notes ?? [];
      const beats = this.groupIntoBeats(notes, bar);
      const barParts: string[] = [];

      for (const beat of beats) {
        const duration = `:${durationName(beat.duration)}`;
        if (beat.notes.length === 0) {
          barParts.push(`${duration} r`);
          continue;
        }
        const tokens = beat.notes.map((n) => this.noteToTex(n, track));
        barParts.push(
          beat.notes.length > 1
            ? `${duration} (${tokens.join(" ")})`
            : `${duration} ${tokens[0]}`,
        );
      }
      bars.push(barParts.join(" ") + " |");
    }
    return bars.join(" ");
  }

  private noteToTex(note: Note, track: Track): string {
    if (track.tuning !== null && note.string !== null && note.fret !== null) {
      // alphaTex note suffix `fret.string` counts strings 1-based from the TOP line
      // (1 = highest pitch); our model is 0-based highest-first.
      const texString = note.string + 1;
      return `${note.fret}.${texString}`;
    }
    // non-fretted instruments: absolute pitch via MIDI-to-name conversion
    return midiToTexPitch(note.pitch);
  }

  /** Groups notes into beats by shared start position, filling gaps with rests. */
  private groupIntoBeats(
    notes: readonly Note[],
    bar: Score["bars"][number],
  ): { start: number; duration: number; notes: Note[] }[] {
    const byStart = new Map<number, { start: number; duration: number; notes: Note[] }>();
    for (const note of notes) {
      let entry = byStart.get(note.start);
      if (!entry) {
        entry = { start: note.start, duration: note.duration, notes: [] };
        byStart.set(note.start, entry);
      }
      entry.notes.push(note);
    }
    const sorted = [...byStart.values()].sort((a, b) => a.start - b.start);
    const capacity = Math.round(
      bar.timeSignature.numerator * ((TICKS_PER_QUARTER * 4) / bar.timeSignature.denominator),
    );
    const result: { start: number; duration: number; notes: Note[] }[] = [];
    let cursor = 0;
    for (const beat of sorted) {
      if (beat.start > cursor) {
        result.push({ start: cursor, duration: beat.start - cursor, notes: [] });
      }
      result.push(beat);
      cursor = beat.start + beat.duration;
    }
    if (cursor < capacity) {
      result.push({ start: cursor, duration: capacity - cursor, notes: [] });
    }
    return result;
  }
}

function durationName(ticks: number): string {
  const names: [number, string][] = [
    [TICKS_PER_QUARTER * 4, "1"],
    [TICKS_PER_QUARTER * 2, "2"],
    [TICKS_PER_QUARTER, "4"],
    [TICKS_PER_QUARTER / 2, "8"],
    [TICKS_PER_QUARTER / 4, "16"],
    [TICKS_PER_QUARTER / 8, "32"],
  ];
  for (const [ticks_, name] of names) {
    if (ticks === ticks_) return name;
  }
  // closest shorter duration — proper tuplet/dot handling comes with the editor
  return "8";
}

const PITCH_NAMES = ["c", "c#", "d", "d#", "e", "f", "f#", "g", "g#", "a", "a#", "b"] as const;

function midiToTexPitch(midi: number): string {
  const name = PITCH_NAMES[midi % 12] ?? "c";
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}

function escapeTex(text: string): string {
  return text.replace(/"/g, '\\"');
}

