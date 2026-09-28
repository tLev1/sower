import { useCallback, useEffect, useRef, useState } from "react";
import type { Score, ScoreDocument, TrackId } from "@sower/core";
import {
  MIN_NOTE_TICKS,
  barStartTick,
  bestFingering,
  humCorrectionPitch,
  locateTick,
  quantizeHumNotes,
  tempoAtBar,
} from "@sower/core";
import { HumInput, type HumNote, type HumState, type PitchFrame } from "@sower/audio";
import { durationTicks, type DurationValue } from "../editor/caret";
import type { useEditor } from "../editor/useEditor";

export type HumMode = "correct" | "enter";

interface CaretLike {
  readonly barIndex: number;
  readonly tick: number;
  readonly stringIndex: number;
}

/**
 * Hum / sing / play correction input (Phase 1c flagship).
 *
 * Two gestures from the same capture pipeline:
 *  - **correct**: sing the pitch a note SHOULD have and the note under the
 *    caret is re-pitched (and re-fingered) to it — the "hum a correction"
 *    interaction from the locked requirements.
 *  - **enter**: hum a phrase and it is quantised onto the entry grid from the
 *    caret, notes written one after another across bar lines.
 *
 * The capture runs through `HumInput` (AudioWorklet → PitchStream → YIN →
 * segmenter); this hook owns the editor side: live read-out while listening
 * and one undoable command batch on stop.
 */
export function useHumInput({
  document: doc,
  editor,
}: {
  document: ScoreDocument;
  editor: ReturnType<typeof useEditor>;
}) {
  const [state, setState] = useState<HumState>("idle");
  const [mode, setMode] = useState<HumMode>("correct");
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState<number | null>(null);
  const [previewCount, setPreviewCount] = useState(0);
  const inputRef = useRef<HumInput | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const caretRef = useRef<CaretLike>(editor.caret);
  caretRef.current = editor.caret;
  const gridRef = useRef<{ value: DurationValue; dotted: boolean }>(editor.entryDuration);
  gridRef.current = editor.entryDuration;

  const stop = useCallback((): void => {
    const input = inputRef.current;
    if (!input) return;
    // stop() flushes the last analysis window into the capture — read the
    // notes afterwards so the tail of the phrase is never dropped
    input.stop();
    inputRef.current = null;
    const notes = input.notes;
    setLevel(0);
    setHeard(null);
    setPreviewCount(0);
    applyCapture(notes, modeRef.current, doc, caretRef.current, gridRef.current);
  }, [doc]);

  const start = useCallback((): void => {
    if (inputRef.current) return;
    const input = new HumInput({
      onState: setState,
      onFrame: (frame: PitchFrame) => {
        setLevel(frame.rms);
        setHeard(frame.hz === null ? null : Math.round(69 + 12 * Math.log2(frame.hz / 440)));
      },
      onNotes: (notes: readonly HumNote[]) => {
        setPreviewCount(notes.length);
      },
    });
    inputRef.current = input;
    void input.start();
  }, []);

  const toggle = useCallback((): void => {
    if (inputRef.current) stop();
    else start();
  }, [start, stop]);

  // never leave a live mic behind
  useEffect(() => {
    return () => {
      inputRef.current?.stop();
      inputRef.current = null;
    };
  }, []);

  return {
    state,
    mode,
    setMode,
    level,
    heard,
    previewCount,
    isListening: state === "listening" || state === "requesting",
    supported: HumInput.isSupported(),
    start,
    stop,
    toggle,
  };
}

/**
 * Turns a finished capture into editor commands. The capture is over — only
 * the document is touched from here on.
 */
function applyCapture(
  notes: readonly HumNote[],
  mode: HumMode,
  doc: ScoreDocument,
  caret: CaretLike,
  entry: { value: DurationValue; dotted: boolean },
): void {
  if (notes.length === 0) return;
  const score = doc.score;
  const track = score.tracks[0];
  const grid = Math.max(MIN_NOTE_TICKS, durationTicks(entry.value, entry.dotted));
  const bar = score.bars[caret.barIndex];
  if (!bar || !track) return;

  if (mode === "correct") {
    // one sung pitch → the note under the caret is re-pitched to it
    const midi = humCorrectionPitch(notes);
    if (midi === null) return;
    const voice = bar.voices[0];
    const target =
      voice?.notes.find((n) => n.start === caret.tick && n.string === caret.stringIndex) ??
      voice?.notes.find((n) => n.start <= caret.tick && caret.tick < n.start + n.duration) ??
      null;
    if (!target) {
      writePhrase(doc, score, track.id, caret, grid, [{ pitch: midi, start: 0, duration: grid }]);
      return;
    }
    doc.execute({
      type: "setNotePitch",
      trackId: track.id,
      barId: bar.id,
      noteId: target.id,
      pitch: midi,
    });
    return;
  }

  const quantized = quantizeHumNotes(notes, {
    quarterBpm: tempoAtBar(score, caret.barIndex),
    gridTicks: grid,
    fromTick: 0,
    maxNotes: 64,
  });
  writePhrase(doc, score, track.id, caret, grid, quantized);
}

/** Writes quantised notes from the caret, spilling across bar lines. */
function writePhrase(
  doc: ScoreDocument,
  score: Score,
  trackId: TrackId,
  caret: CaretLike,
  grid: number,
  notes: readonly { pitch: number; start: number; duration: number }[],
): void {
  const tuning = score.tracks[0]?.tuning ?? null;
  const origin = barStartTick(score, caret.barIndex) + caret.tick;
  for (const note of notes) {
    const where = locateTick(score, origin + note.start);
    const bar = score.bars[where.barIndex];
    if (!bar) continue;
    const barId = bar.id;
    const capacity =
      bar.timeSignature.numerator * ((480 * 4) / bar.timeSignature.denominator);
    const start = Math.min(where.tick, Math.max(0, capacity - Math.min(grid, capacity)));
    const duration = Math.max(MIN_NOTE_TICKS, Math.min(note.duration, capacity - start));
    const fingering = tuning ? bestFingering(tuning, note.pitch, caret.stringIndex) : null;
    doc.execute({
      type: "addNote",
      trackId,
      barId,
      note: {
        pitch: fingering?.pitch ?? note.pitch,
        start,
        duration,
        string: fingering?.string ?? caret.stringIndex,
        ...(fingering ? { fret: fingering.fret } : {}),
      },
    });
  }
}
