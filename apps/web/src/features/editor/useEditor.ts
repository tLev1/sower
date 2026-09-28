import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScoreDocument } from "@sower/core";
import { TICKS_PER_QUARTER, chordSymbol, keyAtBar, tempoMarkAt, type ChordQuality, type VoicedNote } from "@sower/core";
import type { NoteDragEvent, SowerEngine } from "@sower/render";
import type { ClickedPosition } from "@sower/render";
import {
  currentBindings,
  findConflicts,
  resetBindings,
  resolveShortcut,
  setBindings,
  shortcutDef,
  subscribeBindings,
  type ShortcutOverrides,
} from "../../services/shortcuts";
import {
  MAX_FRET,
  capacityOf,
  createCaret,
  durationTicks,
  moveCaretByTicks,
  moveCaretVertically,
  noteAt,
  noteUnderCaret,
  openStringPitch,
  restCovering,
  stringCount,
  type Caret,
  type DurationChoice,
  type DurationValue,
} from "./caret";

export type EditResult = "applied" | "clamped" | "ignored";

interface UseEditorArgs {
  document: ScoreDocument;
  renderer: SowerEngine | null;
}

/** Minimal structural key event — satisfied by both DOM and React events. */
interface KeyLike {
  readonly key: string;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly target: EventTarget | null;
  preventDefault(): void;
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

/**
 * The digit a fret shortcut stands for (0-9), or null when the shortcut is
 * not a digit. `fret.tens.1` / `fret.tens.2` double as "1" / "2" while a
 * two-digit entry is pending, so the tens chord can be repeated.
 */
function fretDigitOf(id: string | null): number | null {
  if (id === null) return null;
  if (id.startsWith("fret.") && id.length === 6) {
    const digit = Number(id.slice(5));
    return Number.isInteger(digit) ? digit : null;
  }
  if (id === "fret.tens.1") return 1;
  if (id === "fret.tens.2") return 2;
  return null;
}

/**
 * A bare modifier press is never an action on its own — it must not cancel a
 * pending two-digit fret entry (Ctrl+1, then holding Ctrl, then 2 → fret 12).
 */
function isModifierCode(code: string): boolean {
  return (
    code === "ControlLeft" ||
    code === "ControlRight" ||
    code === "ShiftLeft" ||
    code === "ShiftRight" ||
    code === "AltLeft" ||
    code === "AltRight" ||
    code === "MetaLeft" ||
    code === "MetaRight"
  );
}

/**
 * Owns caret state and editing on top of a ScoreDocument.
 * Keyboard handling is window-level: the editor responds immediately,
 * without needing focus on the score canvas (pro-app behavior).
 * Entry model (guitarist workflow):
 *  - digits 0-9 place/replace the fret on the current string, using the
 *    selected entry duration (a note-value palette controls it; the choice
 *    persists until changed — Guitar-Pro style entry)
 *    - creating a new beat auto-advances to the next grid step (fast riff entry)
 *    - adding to an existing beat (chord tone) keeps the position and
 *      inherits the beat's duration
 *  - ↑/↓ move across strings; right after a placement they return to the
 *    placed tick so chords build naturally: 3 ↓ 3 ↓ 0
 *  - arrows ←/→ navigate the grid, Backspace deletes, Ctrl+Z/Y history
 *  - Space toggles playback
 * Mouse: clicking anywhere on the tab staff positions the caret on that
 * string and grid step. Right-click / long-press opens the score context
 * menu (tempo / meter / measure actions at that measure).
 */
export function useEditor({ document: doc, renderer }: UseEditorArgs) {
  const [version, setVersion] = useState(0);
  const [caret, setCaret] = useState<Caret>(createCaret);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const caretRef = useRef(caret);
  caretRef.current = caret;
  const rendererRef = useRef(renderer);
  rendererRef.current = renderer;
  /** Tick/string of the last placed note — ↑/↓ return here after auto-advance. */
  const lastPlacedRef = useRef<{ tick: number; stringIndex: number } | null>(null);
  /** Tens digit of an in-progress two-digit fret entry (Ctrl+1/2 → 10-24). */
  const [pendingFret, setPendingFret] = useState<number | null>(null);
  const pendingFretRef = useRef<number | null>(null);
  /** Persistent note-value entry mode: every placed note uses it until changed. */
  const [entryDuration, setEntryDurationState] = useState<DurationChoice>({
    value: "eighth",
    dotted: false,
  });
  const entryDurationRef = useRef(entryDuration);
  entryDurationRef.current = entryDuration;

  /** Caret step = the selected note value (16ths step by 120 ticks). */
  const entryGridTicks = (): number => {
    const chosen = entryDurationRef.current;
    return durationTicks(chosen.value, chosen.dotted);
  };

  useEffect(() => doc.subscribe(() => { setVersion((v) => v + 1); }), [doc]);

  const score = doc.score;

  const execute = useCallback(
    (command: Parameters<ScoreDocument["execute"]>[0]) => {
      doc.execute(command);
    },
    [doc],
  );

  const placeFret = useCallback(
    (fret: number): EditResult => {
      const s = doc.score;
      const c = caretRef.current;
      const bar = s.bars[c.barIndex];
      const track = s.tracks[0];
      if (!bar || !track) return "ignored";

      const existing = noteAt(s, c);
      const pitch = openStringPitch(s, c.stringIndex) + fret;
      const beatNote = existing ??
        bar.voices[0]?.notes.find((n) => n.start === c.tick) ?? null;
      const capacity = capacityOf(s, c.barIndex);
      const chosen = entryDurationRef.current;
      // new notes use the persistent entry duration (clamped to the bar);
      // chord tones added to an existing beat inherit the beat's duration
      const duration = existing
        ? existing.duration
        : Math.max(60, Math.min(
            beatNote ? beatNote.duration : durationTicks(chosen.value, chosen.dotted),
            capacity - c.tick,
          ));

      if (existing) {
        if (existing.fret === fret) return "clamped";
        execute({
          type: "setNotePitch",
          trackId: track.id,
          barId: bar.id,
          noteId: existing.id,
          pitch,
          fret,
        });
      } else {
        execute({
          type: "addNote",
          trackId: track.id,
          barId: bar.id,
          note: {
            pitch,
            start: c.tick,
            duration,
            string: c.stringIndex,
            fret,
          },
        });
      }
      lastPlacedRef.current = { tick: c.tick, stringIndex: c.stringIndex };
      // riff entry: a new beat advances by exactly its duration (16ths land
      // side by side and beam together); chord tones stay put
      setCaret(beatNote ? c : moveCaretByTicks(s, c, duration));
      return "applied";
    },
    [doc, execute],
  );

  /**
   * Selects the persistent entry duration. When the caret sits on a written
   * note or rest, that item's duration is updated too (Guitar-Pro behavior).
   */
  const setEntryDuration = useCallback(
    (value: DurationValue, dotted: boolean): void => {
      setEntryDurationState({ value, dotted });
      const s = doc.score;
      const c = caretRef.current;
      const bar = s.bars[c.barIndex];
      const track = s.tracks[0];
      if (!bar || !track) return;
      const duration = durationTicks(value, dotted);
      const existing = noteAt(s, c);
      if (existing) {
        execute({
          type: "setNoteDuration",
          trackId: track.id,
          barId: bar.id,
          noteId: existing.id,
          duration,
        });
        return;
      }
      const rest = restCovering(bar, c.tick);
      if (rest) {
        execute({ type: "setRestDuration", trackId: track.id, barId: bar.id, restId: rest.id, duration });
      }
    },
    [doc, execute],
  );

  /**
   * Note length from the score's context menu: sets the entry duration for
   * notes written from that point on — and, when a written note or rest sits
   * at the clicked position, changes THAT item only (never the ones after it;
   * the measure simply re-lays out around the new length).
   */
  const applyNoteLength = useCallback(
    (barIndex: number, tick: number, stringIndex: number | null, value: DurationValue, dotted: boolean): void => {
      setEntryDurationState({ value, dotted });
      const s = doc.score;
      const bar = s.bars[barIndex];
      const track = s.tracks[0];
      if (!bar || !track) return;
      const duration = durationTicks(value, dotted);
      const existing = bar.voices[0]?.notes.find(
        (n) => n.start === tick && (stringIndex === null || n.string === stringIndex),
      );
      if (existing) {
        execute({
          type: "setNoteDuration",
          trackId: track.id,
          barId: bar.id,
          noteId: existing.id,
          duration: Math.min(duration, Math.max(60, capacityOf(s, barIndex) - existing.start)),
        });
        return;
      }
      const rest = restCovering(bar, tick);
      if (rest) {
        execute({ type: "setRestDuration", trackId: track.id, barId: bar.id, restId: rest.id, duration });
      }
    },
    [doc, execute],
  );

  /**
   * Writes a rest of the selected entry value at the caret and advances —
   * the measure's auto-fill stays consistent around it (`B` key).
   */
  const writeRest = useCallback((): EditResult => {
    const s = doc.score;
    const c = caretRef.current;
    const bar = s.bars[c.barIndex];
    const track = s.tracks[0];
    if (!bar || !track) return "ignored";
    const chosen = entryDurationRef.current;
    const duration = Math.min(
      durationTicks(chosen.value, chosen.dotted),
      Math.max(60, capacityOf(s, c.barIndex) - c.tick),
    );
    execute({
      type: "addRest",
      trackId: track.id,
      barId: bar.id,
      rest: { start: c.tick, duration },
    });
    lastPlacedRef.current = null;
    setCaret(moveCaretByTicks(s, c, duration));
    return "applied";
  }, [doc, execute]);

  /** Toggles a simple articulation on the note under the caret. */
  const toggleArticulation = useCallback(
    (articulation: "palmMute" | "staccato" | "letRing" | "ghost" | "accent"): EditResult => {
      const s = doc.score;
      const c = caretRef.current;
      const bar = s.bars[c.barIndex];
      const track = s.tracks[0];
      const note = noteUnderCaret(s, c);
      if (!bar || !track || !note) return "ignored";
      execute({
        type: "toggleNoteArticulation",
        trackId: track.id,
        barId: bar.id,
        noteId: note.id,
        articulation,
      });
      return "applied";
    },
    [doc, execute],
  );

  /**
   * Deletes the rest under the caret — a written rest or the auto-filled gap
   * around it — and pulls the rest of the measure earlier by its length
   * ("delete the rest and the next notes move into place").
   */
  const deleteRestAtCaret = useCallback((): EditResult => {
    const s = doc.score;
    const c = caretRef.current;
    const bar = s.bars[c.barIndex];
    const track = s.tracks[0];
    const voice = bar?.voices[0];
    if (!bar || !track || !voice) return "ignored";
    // only pure rest time can be removed — a sounding note owns this tick
    const covering = voice.notes.find((n) => n.start <= c.tick && c.tick < n.start + n.duration);
    if (covering) return "clamped";
    const written = restCovering(bar, c.tick);
    let start: number;
    let duration: number;
    if (written) {
      start = written.start;
      duration = written.duration;
    } else {
      // the auto-filled gap around the caret: from the previous event's end
      // to the next event's start
      let prevEnd = 0;
      let nextStart = capacityOf(s, c.barIndex);
      for (const n of voice.notes) {
        const end = n.start + n.duration;
        if (end <= c.tick && end > prevEnd) prevEnd = end;
        if (n.start > c.tick && n.start < nextStart) nextStart = n.start;
      }
      for (const r of voice.rests ?? []) {
        const end = r.start + r.duration;
        if (end <= c.tick && end > prevEnd) prevEnd = end;
        if (r.start > c.tick && r.start < nextStart) nextStart = r.start;
      }
      start = prevEnd;
      duration = nextStart - prevEnd;
    }
    if (duration < 60) return "clamped";
    execute({ type: "removeRange", trackId: track.id, barId: bar.id, start, duration });
    return "applied";
  }, [doc, execute]);

  const deleteAtCaret = useCallback((): EditResult => {
    const s = doc.score;
    const c = caretRef.current;
    const bar = s.bars[c.barIndex];
    const track = s.tracks[0];
    if (!bar || !track) return "ignored";

    // Backspace: the note on the current string at the caret
    const existing = noteAt(s, c) ?? noteUnderCaret(s, c);
    if (existing) {
      execute({
        type: "removeNote",
        trackId: track.id,
        barId: bar.id,
        noteId: existing.id,
      });
      return "applied";
    }
    // no note here → the written/auto rest under the caret goes away and the
    // rest of the measure is pulled into place
    return deleteRestAtCaret();
  }, [doc, execute, deleteRestAtCaret]);

  /** Del: the whole beat group at the caret (notes on every string). */
  const deleteBeatAtCaret = useCallback((): EditResult => {
    const s = doc.score;
    const c = caretRef.current;
    const bar = s.bars[c.barIndex];
    const track = s.tracks[0];
    if (!bar || !track) return "ignored";
    const hasColumn = (bar.voices[0]?.notes ?? []).some((n) => n.start === c.tick);
    if (hasColumn) {
      execute({ type: "removeBeat", trackId: track.id, barId: bar.id, start: c.tick });
      return "applied";
    }
    return deleteRestAtCaret();
  }, [doc, execute, deleteRestAtCaret]);

  const navigate = useCallback(
    (dx: number, dy: number) => {
      const s = doc.score;
      setCaret((c) => {
        if (dx !== 0) {
          lastPlacedRef.current = null;
          return moveCaretByTicks(s, c, dx * entryGridTicks());
        }
        // vertical: after a placement, return to the placed tick (chord mode)
        const tick = lastPlacedRef.current?.tick ?? c.tick;
        return moveCaretVertically(s, { ...c, tick }, dy);
      });
    },
    [doc],
  );

  const undo = useCallback(() => {
    doc.undo();
  }, [doc]);

  const redo = useCallback(() => {
    doc.redo();
  }, [doc]);

  const appendBar = useCallback((): EditResult => {
    const s = doc.score;
    const lastBar = s.bars[s.bars.length - 1];
    execute({ type: "addBar", afterBarId: lastBar ? lastBar.id : null });
    return "applied";
  }, [doc, execute]);

  /** Inserts an empty measure right after `barIndex` (inheriting its meter). */
  const insertBarAfter = useCallback((barIndex: number): void => {
    const bar = doc.score.bars[barIndex];
    if (!bar) return;
    execute({ type: "addBar", afterBarId: bar.id });
  }, [doc, execute]);

  /** Deletes the given measure (refuses to empty the score). */
  const removeBarAt = useCallback((barIndex: number): boolean => {
    const s = doc.score;
    const bar = s.bars[barIndex];
    if (!bar || s.bars.length <= 1) return false;
    execute({ type: "removeBar", barId: bar.id });
    return true;
  }, [doc, execute]);

  /** Sets a tempo marker at an exact measure (notated beat unit included). */
  const setTempoAtBar = useCallback((barIndex: number, bpm: number, unitTicks?: number | null): void => {
    const bar = doc.score.bars[barIndex];
    if (!bar) return;
    if (unitTicks === undefined) {
      execute({ type: "setBarTempo", barId: bar.id, tempo: bpm });
    } else {
      execute({ type: "setBarTempo", barId: bar.id, tempo: bpm, unitTicks });
    }
  }, [doc, execute]);

  /** Removes the tempo marker at a measure (the previous one carries again). */
  const removeTempoAtBar = useCallback((barIndex: number): void => {
    const bar = doc.score.bars[barIndex];
    if (!bar || bar.tempo === null) return;
    execute({ type: "setBarTempo", barId: bar.id, tempo: null });
  }, [doc, execute]);

  /** Edits the score title / author (from the editable header). */
  const setScoreMeta = useCallback((title?: string, artist?: string): void => {
    if (title === undefined && artist === undefined) return;
    execute({
      type: "setScoreMeta",
      ...(title !== undefined ? { title } : {}),
      ...(artist !== undefined ? { artist } : {}),
    });
  }, [doc, execute]);

  /** Key-signature change at a measure (until the next differing change). */
  const setKeySignatureAtBar = useCallback(
    (barIndex: number, fifths: number, mode: "major" | "minor"): void => {
      const bar = doc.score.bars[barIndex];
      if (!bar) return;
      execute({ type: "setKeySignature", barId: bar.id, fifths, mode });
    },
    [doc, execute],
  );

  /** Chord-sheet entry: lead-sheet symbol + a chosen voicing for N ticks. */
  const addChordAtBar = useCallback(
    (
      barIndex: number,
      rootPc: number,
      quality: ChordQuality,
      duration: number,
      notes: readonly VoicedNote[],
    ): void => {
      const s = doc.score;
      const bar = s.bars[barIndex];
      const track = s.tracks[0];
      if (!bar || !track) return;
      const key = keyAtBar(s, barIndex);
      const symbol = chordSymbol(rootPc, quality, key.fifths);
      execute({
        type: "addChord",
        trackId: track.id,
        barId: bar.id,
        duration,
        symbol,
        notes: notes.map((n) => ({ pitch: n.pitch, string: n.string, fret: n.fret })),
      });
    },
    [doc, execute],
  );

  /** Changes the time signature from measure `barIndex` onward. */
  const setTimeSignatureAtBar = useCallback((barIndex: number, numerator: number, denominator: number): void => {
    const bar = doc.score.bars[barIndex];
    if (!bar) return;
    execute({ type: "setTimeSignature", barId: bar.id, numerator, denominator });
  }, [doc, execute]);

  const setTempo = useCallback((bpm: number, unitTicks?: number | null): void => {
    const s = doc.score;
    const barIndex = Math.max(0, Math.min(caretRef.current.barIndex, s.bars.length - 1));
    const unit = unitTicks ?? tempoMarkAt(s, barIndex)?.unitTicks ?? TICKS_PER_QUARTER;
    setTempoAtBar(barIndex, bpm, unit);
  }, [doc, setTempoAtBar]);

  const setTimeSignature = useCallback((numerator: number, denominator: number): void => {
    setTimeSignatureAtBar(caretRef.current.barIndex, numerator, denominator);
  }, [setTimeSignatureAtBar]);

  const removeLastBar = useCallback((): EditResult => {
    const s = doc.score;
    const lastBar = s.bars[s.bars.length - 1];
    if (!lastBar || s.bars.length <= 1) return "clamped";
    execute({ type: "removeBar", barId: lastBar.id });
    return "applied";
  }, [doc, execute]);

  // -- rebindable keyboard shortcuts ----------------------------------------

  const [shortcuts, setShortcutsState] = useState<ShortcutOverrides>(currentBindings);
  useEffect(() => subscribeBindings(() => { setShortcutsState(currentBindings()); }), []);
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  /** Applies new bindings (persists them; every keymap updates immediately). */
  const setShortcuts = useCallback((next: ShortcutOverrides): void => {
    setBindings(next);
  }, []);

  /** Restores every shortcut to its default binding. */
  const resetShortcuts = useCallback((): void => {
    resetBindings();
  }, []);

  const shortcutConflicts = useMemo(() => findConflicts(shortcuts), [shortcuts]);

  const handleKeyDown = useCallback(
    (e: KeyLike) => {
      if (isModifierCode(e.code)) return;
      const textEntry = isTextEntryTarget(e.target);
      const id = resolveShortcut(e, shortcutsRef.current);
      const def = id ? shortcutDef(id) : null;

      // a pending two-digit fret is completed by ANY digit shortcut — plain or
      // with the tens modifier still held (Ctrl+1 then Ctrl+2 = fret 12) —
      // and cancelled by any other key
      if (pendingFretRef.current !== null) {
        const digit = fretDigitOf(id);
        if (digit !== null) {
          e.preventDefault();
          const fret = pendingFretRef.current * 10 + digit;
          pendingFretRef.current = null;
          setPendingFret(null);
          if (fret <= MAX_FRET) placeFret(fret);
          return;
        }
        pendingFretRef.current = null;
        setPendingFret(null);
      }

      if (!id || !def) return;
      if (textEntry && !def.global) return;
      e.preventDefault();

      switch (id) {
        case "fret.0":
        case "fret.1":
        case "fret.2":
        case "fret.3":
        case "fret.4":
        case "fret.5":
        case "fret.6":
        case "fret.7":
        case "fret.8":
        case "fret.9":
          placeFret(Number(id.slice(5)));
          break;
        case "fret.tens.1":
          pendingFretRef.current = 1;
          setPendingFret(1);
          break;
        case "fret.tens.2":
          pendingFretRef.current = 2;
          setPendingFret(2);
          break;
        case "entry.rest":
          writeRest();
          break;
        case "artic.palmMute":
          toggleArticulation("palmMute");
          break;
        case "artic.staccato":
          toggleArticulation("staccato");
          break;
        case "artic.letRing":
          toggleArticulation("letRing");
          break;
        case "artic.ghost":
          toggleArticulation("ghost");
          break;
        case "artic.accent":
          toggleArticulation("accent");
          break;
        case "nav.left":
          navigate(-1, 0);
          break;
        case "nav.right":
          navigate(1, 0);
          break;
        case "nav.up":
          navigate(0, -1);
          break;
        case "nav.down":
          navigate(0, 1);
          break;
        case "edit.deleteNote":
          deleteAtCaret();
          break;
        case "edit.deleteBeat":
          deleteBeatAtCaret();
          break;
        case "edit.undo":
          undo();
          break;
        case "edit.redo":
          redo();
          break;
        case "transport.playPause":
          rendererRef.current?.toggle();
          break;
        case "app.shortcuts":
          setShortcutsOpen((open) => !open);
          break;
        default:
          break;
      }
    },
    [
      placeFret,
      deleteAtCaret,
      deleteBeatAtCaret,
      writeRest,
      toggleArticulation,
      navigate,
      undo,
      redo,
    ],
  );

  // window-level keyboard: editing works without focusing the score canvas
  useEffect(() => {
    const listener = (e: KeyboardEvent): void => {
      handleKeyDown(e);
    };
    window.addEventListener("keydown", listener);
    return () => {
      window.removeEventListener("keydown", listener);
    };
  }, [handleKeyDown]);

  const handleBeatClick = useCallback(
    (position: ClickedPosition) => {
      const s = doc.score;
      const barIndex = Math.min(position.barIndex, Math.max(0, s.bars.length - 1));
      const capacity = capacityOf(s, barIndex);
      // snap to the SELECTED note value's grid — a 16th entry can land on
      // any 16th of the measure (the measure is freely writable)
      const grid = Math.max(60, entryGridTicks());
      const tick = Math.min(
        Math.max(0, Math.round(position.tick / grid) * grid),
        Math.max(0, capacity - Math.min(grid, capacity)),
      );
      const maxString = stringCount(s) - 1;
      const stringIndex =
        position.stringIndex === null
          ? caretRef.current.stringIndex
          : Math.min(maxString, Math.max(0, position.stringIndex));
      lastPlacedRef.current = null;
      setCaret({ barIndex, tick, stringIndex });
    },
    [doc],
  );

  // caret follows clicks on the rendered score
  useEffect(() => {
    if (!renderer) return;
    return renderer.onScoreClicked(handleBeatClick);
  }, [renderer, handleBeatClick]);

  /**
   * Direct manipulation (Phase 1c): the engine resolves the geometry and
   * snaps the gesture; the editor turns the released proposal into domain
   * commands. A pitch drag re-fingers the note; a duration-edge drag resizes
   * the whole rhythmic column it belongs to (a chord shares one value) and
   * never overwrites the notes after it.
   */
  const applyNoteDrag = useCallback(
    (event: NoteDragEvent) => {
      if (event.phase !== "end") return;
      const s = doc.score;
      const bar = s.bars[event.barIndex];
      const track = s.tracks[0];
      const voice = bar?.voices[0];
      if (!bar || !track || !voice) return;
      const target = voice.notes.find((n) => n.id === event.noteId);
      if (!target) return;

      if (event.handle === "body") {
        if (event.pitch === undefined || event.pitch === target.pitch) return;
        execute({
          type: "setNotePitch",
          trackId: track.id,
          barId: bar.id,
          noteId: target.id,
          pitch: event.pitch,
          ...(event.fret !== undefined ? { fret: event.fret } : {}),
          ...(event.string !== undefined ? { string: event.string } : {}),
        });
        lastPlacedRef.current = null;
        setCaret({
          barIndex: event.barIndex,
          tick: target.start,
          stringIndex: event.string ?? target.string ?? caretRef.current.stringIndex,
        });
        return;
      }

      const duration = event.duration;
      if (duration === undefined || duration === target.duration) return;
      // the rhythmic column moves as one: every note sharing this note's
      // start and length resizes together (a chord is one beat)
      for (const note of voice.notes) {
        if (note.start !== target.start || note.duration !== target.duration) continue;
        execute({
          type: "setNoteDuration",
          trackId: track.id,
          barId: bar.id,
          noteId: note.id,
          duration,
        });
      }
      lastPlacedRef.current = null;
      setCaret({
        barIndex: event.barIndex,
        tick: target.start,
        stringIndex: target.string ?? caretRef.current.stringIndex,
      });
    },
    [doc, execute],
  );

  // direct manipulation: drag pitch / drag duration edge on the rendered score
  useEffect(() => {
    if (!renderer) return;
    return renderer.onNoteDrag(applyNoteDrag);
  }, [renderer, applyNoteDrag]);

  // keep caret inside bounds after structural changes
  useEffect(() => {
    setCaret((c) => {
      const s = doc.score;
      const barIndex = Math.min(c.barIndex, Math.max(0, s.bars.length - 1));
      const capacity = capacityOf(s, barIndex);
      const grid = Math.min(Math.max(60, entryGridTicks()), capacity);
      const tick = Math.min(c.tick, Math.max(0, capacity - grid));
      return { ...c, barIndex, tick };
    });
  }, [doc, version]);

  const caretInfo = useMemo(() => {
    const bar = score.bars[caret.barIndex];
    const grid = Math.max(60, durationTicks(entryDuration.value, entryDuration.dotted));
    const gridStep = bar ? caret.tick / grid : 0;
    return {
      bar: caret.barIndex + 1,
      string: caret.stringIndex + 1,
      step: Math.round(gridStep) + 1,
    };
  }, [score, caret, entryDuration]);

  return {
    score,
    version,
    caret,
    caretInfo,
    pendingFret,
    entryDuration,
    container,
    setContainer,
    placeFret,
    writeRest,
    setEntryDuration,
    applyNoteLength,
    deleteAtCaret,
    navigate,
    undo,
    redo,
    appendBar,
    insertBarAfter,
    removeBarAt,
    removeLastBar,
    setTempo,
    setTempoAtBar,
    removeTempoAtBar,
    setScoreMeta,
    setKeySignatureAtBar,
    addChordAtBar,
    setTimeSignature,
    setTimeSignatureAtBar,
    handleKeyDown,
    shortcuts,
    shortcutConflicts,
    shortcutsOpen,
    setShortcutsOpen,
    setShortcuts,
    resetShortcuts,
  };
}
