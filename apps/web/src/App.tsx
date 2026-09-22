import { useEffect, useRef, useState } from "react";
import { ScoreDocument } from "@stdbd/core";
import { StdbdEngine } from "@stdbd/render";
import { ScoreEditor } from "./features/editor/ScoreEditor";
import { useEditor } from "./features/editor/useEditor";
import { TransportBar } from "./features/playback/TransportBar";
import { demoScore } from "./demo/demoScore";
import { attachAutosave, loadActiveScore } from "./services/score-store";

export function App() {
  const [doc] = useState(() => new ScoreDocument({ initialScore: demoScore }));
  const [renderer, setRenderer] = useState<StdbdEngine | null>(null);
  const rendererRef = useRef<StdbdEngine | null>(null);
  const editor = useEditor({ document: doc, renderer });

  const { container } = editor;

  // mount the engine once the editor container exists (StrictMode-safe)
  useEffect(() => {
    if (!container || rendererRef.current) return;
    const instance = new StdbdEngine(container);
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

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand-row">
          <span className="brand">stdBd</span>
          <span className="subtitle">Guitar Tab Editor — Phase 1a</span>
        </div>
        <TransportBar
          renderer={renderer}
          canUndo={doc.canUndo}
          canRedo={doc.canRedo}
          onUndo={editor.undo}
          onRedo={editor.redo}
        />
      </header>
      <main className="workspace">
        <ScoreEditor
          score={editor.score}
          caret={editor.caret}
          editor={editor}
          renderer={renderer}
        />
      </main>
    </div>
  );
}
