import { useEffect, useRef } from "react";
import { openStringPitch, type Caret } from "./caret";
import type { useEditor } from "./useEditor";
import type { AlphaTabRenderer } from "@stdbd/render";
import type { Score } from "@stdbd/core";

interface ScoreEditorProps {
  score: Score;
  caret: Caret;
  editor: ReturnType<typeof useEditor>;
  renderer: AlphaTabRenderer | null;
}

/**
 * The score canvas + keyboard editing surface.
 * Keyboard-first workflow (Phase 1a): arrows navigate, digits enter frets,
 * Backspace deletes, Ctrl+Z/Shift+Z history, Space toggles playback.
 */
export function ScoreEditor({ score, caret, editor, renderer }: ScoreEditorProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  // re-render whenever the document changes
  useEffect(() => {
    if (renderer) renderer.loadScore(score);
  }, [renderer, score]);

  // position the caret overlay over the current master bar
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay || !renderer) return;
    const rect = renderer.getBarRect(caret.barIndex);
    if (rect) {
      overlay.style.display = "block";
      overlay.style.left = `${rect.x}px`;
      overlay.style.top = `${rect.y}px`;
      overlay.style.width = `${rect.w}px`;
      overlay.style.height = `${rect.h}px`;
    } else {
      overlay.style.display = "none";
    }
  }, [renderer, caret, score]);

  const stringLabels = Array.from(
    { length: score.tracks[0]?.tuning?.strings.length ?? 0 },
    (_, i) => openStringPitch(score, i),
  );

  return (
    <div className="editor-wrap">
      <div className="score-stack">
        <div className="score-scroll" role="application" aria-label="Score editor" ref={editor.setContainer} />
        <div ref={overlayRef} className="caret-overlay" />
      </div>
      <div className="status-bar">
        <span>
          Bar {editor.caretInfo.bar} · String {editor.caretInfo.string} · Step{" "}
          {editor.caretInfo.step}
        </span>
        <span className="hint">
          Click a beat · Arrows navigate · 0-9 frets · Backspace delete · Ctrl+Z undo · Space play
        </span>
        <span className="strings">
          {stringLabels.map((midi, i) => (
            <span key={i} className={i === caret.stringIndex ? "string active" : "string"}>
              {midiName(midi)}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

function midiName(midi: number): string {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${names[midi % 12]}${Math.floor(midi / 12) - 1}`;
}
