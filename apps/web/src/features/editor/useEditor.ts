import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScoreDocument } from "@stdbd/core";
import type { StdbdEngine } from "@stdbd/render";
import type { ClickedPosition } from "@stdbd/render";
import {
  GRID_TICKS,
  MAX_FRET,
  capacityOf,
  createCaret,
  moveCaretHorizontally,
  moveCaretVertically,
  noteAt,
  openStringPitch,
  stringCount,
  type Caret,
} from "./caret";

export type EditResult = "applied" | "clamped" | "ignored";

interface UseEditorArgs {
  document: ScoreDocument;
  renderer: StdbdEngine | null;
}

/** Minimal structural key event — satisfied by both DOM and React events. */
interface KeyLike {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
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
 * Owns caret state and editing on top of a ScoreDocument.
 * Keyboard handling is window-level: the editor responds immediately,
 * without needing focus on the score canvas (pro-app behavior).
 * Entry model (guitarist workflow):
 *  - digits 0-9 place/replace the fret on the current string
 *    - creating a new beat auto-advances to the next grid step (fast riff entry)
 *    - adding to an existing beat (chord tone) keeps the position
 *  - ↑/↓ move across strings; right after a placement they return to the
 *    placed tick so chords build naturally: 3 ↓ 3 ↓ 0
 *  - arrows ←/→ navigate the grid, Backspace deletes, Ctrl+Z/Y history
 *  - Space toggles playback
 * Mouse: clicking anywhere on the tab staff positions the caret on that
 * string and grid step.
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
      const beatExists = bar.voices[0]?.notes.some((n) => n.start === c.tick) ?? false;

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
            duration: GRID_TICKS,
            string: c.stringIndex,
            fret,
          },
        });
      }
      lastPlacedRef.current = { tick: c.tick, stringIndex: c.stringIndex };
      // riff entry: a newly created beat auto-advances; chord tones stay
      setCaret(beatExists ? c : moveCaretHorizontally(s, c, 1));
      return "applied";
    },
    [doc, execute],
  );

  const deleteAtCaret = useCallback((): EditResult => {
    const s = doc.score;
    const c = caretRef.current;
    const bar = s.bars[c.barIndex];
    const track = s.tracks[0];
    if (!bar || !track) return "ignored";

    const existing = noteAt(s, c);
    if (existing) {
      execute({
        type: "removeNote",
        trackId: track.id,
        barId: bar.id,
        noteId: existing.id,
      });
      return "applied";
    }
    if (c.tick > 0 || c.barIndex > 0) {
      setCaret(moveCaretHorizontally(s, c, -1));
      return "applied";
    }
    return "clamped";
  }, [doc, execute]);

  const navigate = useCallback(
    (dx: number, dy: number) => {
      const s = doc.score;
      setCaret((c) => {
        if (dx !== 0) {
          lastPlacedRef.current = null;
          return moveCaretHorizontally(s, c, dx);
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

  const setTempo = useCallback((bpm: number): void => {
    const s = doc.score;
    const bar = s.bars[caretRef.current.barIndex];
    if (!bar) return;
    execute({ type: "setBarTempo", barId: bar.id, tempo: bpm });
  }, [doc, execute]);

  const setTimeSignature = useCallback((numerator: number, denominator: number): void => {
    const s = doc.score;
    const bar = s.bars[caretRef.current.barIndex];
    if (!bar) return;
    execute({ type: "setTimeSignature", barId: bar.id, numerator, denominator });
  }, [doc, execute]);

  const removeLastBar = useCallback((): EditResult => {
    const s = doc.score;
    const lastBar = s.bars[s.bars.length - 1];
    if (!lastBar || s.bars.length <= 1) return "clamped";
    execute({ type: "removeBar", barId: lastBar.id });
    return "applied";
  }, [doc, execute]);

  const handleKeyDown = useCallback(
    (e: KeyLike) => {
      if (isTextEntryTarget(e.target)) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        pendingFretRef.current = null;
        setPendingFret(null);
        return;
      }
      if (ctrl && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        pendingFretRef.current = null;
        setPendingFret(null);
        return;
      }
      if (ctrl) {
        // Ctrl+1 / Ctrl+2 start a two-digit fret entry (frets 10-24).
        // The next digit — plain, or still with Ctrl held — completes it.
        if (/^[0-9]$/.test(e.key)) {
          e.preventDefault();
          const d = Number(e.key);
          const pending = pendingFretRef.current;
          if (pending !== null) {
            const fret = pending * 10 + d;
            pendingFretRef.current = null;
            setPendingFret(null);
            if (fret <= MAX_FRET) placeFret(fret);
          } else if (d === 1 || d === 2) {
            pendingFretRef.current = d;
            setPendingFret(d);
          }
        }
        return;
      }

      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        const pending = pendingFretRef.current;
        if (pending !== null) {
          const fret = pending * 10 + Number(e.key);
          pendingFretRef.current = null;
          setPendingFret(null);
          if (fret <= MAX_FRET) placeFret(fret);
          return;
        }
        placeFret(Number(e.key));
        return;
      }
      if (pendingFretRef.current !== null && e.key !== "Shift") {
        pendingFretRef.current = null;
        setPendingFret(null);
      }
      switch (e.key) {
        case "ArrowRight":
          e.preventDefault();
          navigate(1, 0);
          break;
        case "ArrowLeft":
          e.preventDefault();
          navigate(-1, 0);
          break;
        case "ArrowUp":
          e.preventDefault();
          navigate(0, -1);
          break;
        case "ArrowDown":
          e.preventDefault();
          navigate(0, 1);
          break;
        case "Backspace":
          e.preventDefault();
          deleteAtCaret();
          break;
        case " ":
          e.preventDefault();
          rendererRef.current?.toggle();
          break;
      }
    },
    [placeFret, deleteAtCaret, navigate, undo, redo],
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
      const tick = Math.min(
        Math.max(0, Math.round(position.tick / GRID_TICKS) * GRID_TICKS),
        capacity - GRID_TICKS,
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

  // keep caret inside bounds after structural changes
  useEffect(() => {
    setCaret((c) => {
      const s = doc.score;
      const barIndex = Math.min(c.barIndex, Math.max(0, s.bars.length - 1));
      const tick = Math.min(c.tick, Math.max(0, capacityOf(s, barIndex) - GRID_TICKS));
      return { ...c, barIndex, tick };
    });
  }, [doc, version]);

  const caretInfo = useMemo(() => {
    const bar = score.bars[caret.barIndex];
    const gridStep = bar ? caret.tick / GRID_TICKS : 0;
    return {
      bar: caret.barIndex + 1,
      string: caret.stringIndex + 1,
      step: Math.round(gridStep) + 1,
    };
  }, [score, caret]);

  return {
    score,
    version,
    caret,
    caretInfo,
    pendingFret,
    container,
    setContainer,
    placeFret,
    deleteAtCaret,
    navigate,
    undo,
    redo,
    appendBar,
    removeLastBar,
    setTempo,
    setTimeSignature,
    handleKeyDown,
  };
}
