import { useCallback, useEffect, useState } from "react";
import { openStringPitch, type Caret } from "./caret";
import { DurationPicker } from "./DurationPicker";
import { SheetMenu, type SheetMenuState } from "./SheetMenu";
import type { useEditor } from "./useEditor";
import type { SowerEngine } from "@sower/render";
import type { Score } from "@sower/core";

interface ScoreEditorProps {
  score: Score;
  caret: Caret;
  editor: ReturnType<typeof useEditor>;
  renderer: SowerEngine | null;
}

/**
 * The score canvas + keyboard editing surface.
 * The engine draws the score and the caret/playhead overlays; React only
 * keeps it in sync with the document and caret state. Clickable marks open
 * the tempo/meter popovers; right-click (desktop) or long-press (touch)
 * opens the score context menu.
 */
export function ScoreEditor({ score, caret, editor, renderer }: ScoreEditorProps) {
  const [menu, setMenu] = useState<SheetMenuState | null>(null);

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

  // editable sheet marks + score context menu
  useEffect(() => {
    if (!renderer) return;
    const offMarker = renderer.onSheetMarkerClicked((click) => {
      setMenu({
        kind: click.action === "edit-tempo" ? "tempo" : "timesig",
        barIndex: click.barIndex,
        x: click.clientX,
        y: click.clientY,
      });
    });
    const offContext = renderer.onContextMenu((request) => {
      setMenu({
        kind: "context",
        barIndex: request.barIndex,
        x: request.clientX,
        y: request.clientY,
        tick: request.tick,
        stringIndex: request.stringIndex,
      });
    });
    return () => {
      offMarker();
      offContext();
    };
  }, [renderer]);

  const closeMenu = useCallback(() => { setMenu(null); }, []);

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
        <DurationPicker
          value={editor.entryDuration.value}
          dotted={editor.entryDuration.dotted}
          onSelect={editor.setEntryDuration}
        />
        <span className="hint">
          Click a beat · B writes rests · 0-9 frets · value palette sets note length · Right-click/long-press for
          tempo, meter & measures · Ctrl+Z undo · Space play
        </span>
        <span className="strings">
          {stringLabels.map((midi, i) => (
            <span key={i} className={i === caret.stringIndex ? "string active" : "string"}>
              {midiName(midi)}
            </span>
          ))}
        </span>
      </div>
      {menu ? (
        <SheetMenu
          menu={menu}
          score={score}
          entryDuration={editor.entryDuration}
          onClose={closeMenu}
          onMenuAction={setMenu}
          onTempoChange={(barIndex, bpm, unitTicks) => { editor.setTempoAtBar(barIndex, bpm, unitTicks); }}
          onRemoveTempo={editor.removeTempoAtBar}
          onTimeSignatureChange={editor.setTimeSignatureAtBar}
          onNoteLength={(value, dotted) => { editor.applyNoteLength(menu.barIndex, menu.tick ?? 0, menu.stringIndex ?? null, value, dotted); }
          }
          onInsertMeasure={editor.insertBarAfter}
          onDeleteMeasure={(barIndex) => editor.removeBarAt(barIndex)}
        />
      ) : null}
    </div>
  );
}

function midiName(midi: number): string {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${names[midi % 12]}${Math.floor(midi / 12) - 1}`;
}
