import { useEffect, useRef, useState } from "react";
import { ScoreDocument } from "@sower/core";
import { SowerEngine } from "@sower/render";
import { ScoreEditor } from "./features/editor/ScoreEditor";
import { useEditor } from "./features/editor/useEditor";
import { TransportBar } from "./features/playback/TransportBar";
import { ShortcutsPanel } from "./features/settings/ShortcutsPanel";
import { useShortcut } from "./services/useShortcut";
import { demoScore } from "./demo/demoScore";
import { attachAutosave, loadActiveScore } from "./services/score-store";

export function App() {
  const [doc] = useState(() => new ScoreDocument({ initialScore: demoScore }));
  const [renderer, setRenderer] = useState<SowerEngine | null>(null);
  const rendererRef = useRef<SowerEngine | null>(null);
  const editor = useEditor({ document: doc, renderer });

  const { container } = editor;

  // the shortcuts panel is itself rebindable (registry id: app.shortcuts)
  useShortcut("app.shortcuts", () => {
    editor.setShortcutsOpen(!editor.shortcutsOpen);
  });

  // mount the engine once the editor container exists (StrictMode-safe)
  useEffect(() => {
    if (!container || rendererRef.current) return;
    const instance = new SowerEngine(container);
    instance.mount();
    rendererRef.current = instance;
    setRenderer(instance);
  }, [container]);

  useEffect(() => {
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

  // restore last session, then autosave on every edit
  useEffect(() => {
    let cancelled = false;
    void loadActiveScore().then((saved) => {
      if (!cancelled && saved) doc.reset(saved);
    });
    const off = attachAutosave(doc);
    return () => {
      cancelled = true;
      off();
    };
  }, [doc]);

  // prewarm audio on the first user gesture (pointer or key) → instant play
  useEffect(() => {
    const prewarm = (): void => {
      rendererRef.current?.prewarm();
    };
    window.addEventListener("pointerdown", prewarm, { capture: true });
    window.addEventListener("keydown", prewarm, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", prewarm, { capture: true });
      window.removeEventListener("keydown", prewarm, { capture: true });
    };
  }, []);

  // debug/test hook — used by scripts and E2E (mirrors __sowerRenderer)
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__sowerDoc = doc;
    return () => {
      delete (window as unknown as Record<string, unknown>).__sowerDoc;
    };
  }, [doc]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand-row">
          <span className="brand">Sower</span>
          <span className="subtitle">Guitar Tab Editor — Phase 1a</span>
        </div>
        <TransportBar
          renderer={renderer}
          score={editor.score}
          caretBarIndex={editor.caret.barIndex}
          canUndo={doc.canUndo}
          canRedo={doc.canRedo}
          onUndo={editor.undo}
          onRedo={editor.redo}
          onTempoChange={editor.setTempo}
          onTimeSignatureChange={editor.setTimeSignature}
        />
        <button
          type="button"
          className="tool-btn"
          onClick={() => { editor.setShortcutsOpen(!editor.shortcutsOpen); }}
          title="Keyboard shortcuts (Ctrl+/)"
        >
          Keys
        </button>
      </header>
      <main className="workspace">
        <ScoreEditor
          score={editor.score}
          caret={editor.caret}
          editor={editor}
          renderer={renderer}
          doc={doc}
        />
      </main>
      <ShortcutsPanel
        open={editor.shortcutsOpen}
        overrides={editor.shortcuts}
        conflicts={editor.shortcutConflicts}
        onChange={editor.setShortcuts}
        onResetAll={editor.resetShortcuts}
        onClose={() => { editor.setShortcutsOpen(false); }}
      />
    </div>
  );
}
