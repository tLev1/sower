import { useEffect } from "react";
import { openStringPitch, type Caret } from "./caret";
import type { useEditor } from "./useEditor";
import type { StdbdEngine } from "@stdbd/render";
import type { Score } from "@stdbd/core";

interface ScoreEditorProps {
  score: Score;
  caret: Caret;
  editor: ReturnType<typeof useEditor>;
  renderer: StdbdEngine | null;
}

/**
 * The score canvas + keyboard editing surface.
 * The engine draws the score and the caret/playhead overlays; React only
 * keeps it in sync with the document and caret state.
 */
export function ScoreEditor({ score, caret, editor, renderer }: ScoreEditorProps) {
  // re-render whenever the document changes
  useEffect(() => {
    if (renderer) renderer.loadScore(score);
  }, [renderer, score]);

  // caret line follows the editing position; playback starts from the caret
  useEffect(() => {
    if (!renderer) return;
    renderer.setCaret({
      barIndex: caret.barIndex,
      tick: caret.tick,
      stringIndex: caret.stringIndex,
    });
    renderer.setStartPosition({ barIndex: caret.barIndex, tick: caret.tick });
  }, [renderer, caret, score]);

  // measure controls on the sheet
  useEffect(() => {
    if (!renderer) return;
    const offAdd = renderer.onAppendBarClicked(() => editor.appendBar());
    const offRemove = renderer.onRemoveBarClicked(() => editor.removeLastBar());
    return () => {
      offAdd();
      offRemove();
    };
  }, [renderer, editor.appendBar, editor.removeLastBar]);

  const stringLabels = Array.from(
    { length: score.tracks[0]?.tuning?.strings.length ?? 0 },
    (_, i) => openStringPitch(score, i),
  );

  return (
    <div className="editor-wrap">
      <div className="score-stack">
        <div className="score-scroll" role="application" aria-label="Score editor" ref={editor.setContainer} />
      </div>
      <div className="status-bar">
        <span>
          Bar {editor.caretInfo.bar} · String {editor.caretInfo.string} · Step{" "}
          {editor.caretInfo.step}
          {editor.pendingFret !== null ? ` · Fret ${editor.pendingFret}_` : ""}
        </span>
        <span className="hint">
          Click a beat · Arrows navigate · 0-9 frets · Ctrl+1/2 then digit for 10-24 · Backspace
          delete · Ctrl+Z undo · Space play
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
