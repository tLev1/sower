import { useEffect, useState } from "react";
import type { StdbdEngine } from "@stdbd/render";

interface TransportBarProps {
  renderer: StdbdEngine | null;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export function TransportBar({ renderer, canUndo, canRedo, onUndo, onRedo }: TransportBarProps) {
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!renderer) return;
    return renderer.onStateChange(setPlaying);
  }, [renderer]);

  return (
    <div className="transport">
      <button
        className={playing ? "transport-btn playing" : "transport-btn"}
        onClick={() => renderer?.toggle()}
        disabled={!renderer}
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? "⏸" : "▶"}
      </button>
      <button
        className="transport-btn"
        onClick={() => renderer?.stop()}
        disabled={!renderer}
        aria-label="Stop"
      >
        ■
      </button>
      <div className="divider" />
      <button className="tool-btn" onClick={onUndo} disabled={!canUndo} aria-label="Undo">
        Undo
      </button>
      <button className="tool-btn" onClick={onRedo} disabled={!canRedo} aria-label="Redo">
        Redo
      </button>
    </div>
  );
}
