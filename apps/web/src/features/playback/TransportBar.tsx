import { useEffect, useState } from "react";
import type { StdbdEngine } from "@stdbd/render";
import { tempoAtBar, type Score } from "@stdbd/core";

interface TransportBarProps {
  renderer: StdbdEngine | null;
  score: Score;
  caretBarIndex: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onTempoChange: (bpm: number) => void;
  onTimeSignatureChange: (numerator: number, denominator: number) => void;
}

const TIME_SIGNATURES: readonly { readonly n: number; readonly d: number }[] = [
  { n: 4, d: 4 },
  { n: 3, d: 4 },
  { n: 2, d: 4 },
  { n: 5, d: 4 },
  { n: 6, d: 8 },
  { n: 9, d: 8 },
  { n: 12, d: 8 },
  { n: 7, d: 8 },
];

export function TransportBar({
  renderer,
  score,
  caretBarIndex,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onTempoChange,
  onTimeSignatureChange,
}: TransportBarProps) {
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!renderer) return;
    return renderer.onStateChange(setPlaying);
  }, [renderer]);

  const tempo = tempoAtBar(score, Math.max(0, caretBarIndex));
  const sig = score.bars[Math.max(0, caretBarIndex)]?.timeSignature ?? { numerator: 4, denominator: 4 };
  const sigLabel = (n: number, d: number): string => `${n}/${d}`;

  return (
    <div className="transport">
      <button
        className={playing ? "transport-btn playing" : "transport-btn"}
        onClick={() => {
          renderer?.toggle();
        }}
        disabled={!renderer}
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? "⏸" : "▶"}
      </button>
      <button
        className="transport-btn"
        onClick={() => {
          renderer?.stop();
        }}
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
      <div className="divider" />
      <label className="field">
        <span className="field-icon">♩</span>
        <TempoField value={tempo} onCommit={onTempoChange} />
        <span className="field-label">BPM</span>
      </label>
      <label className="field">
        <span className="field-label">Meter</span>
        <select
          className="field-select"
          value={sigLabel(sig.numerator, sig.denominator)}
          onChange={(e) => {
            const [n, d] = (e.target.value.split("/").map(Number));
            if (n !== undefined && d !== undefined) onTimeSignatureChange(n, d);
          }}
          aria-label="Time signature"
        >
          {TIME_SIGNATURES.map((ts) => (
            <option key={`${ts.n}/${ts.d}`} value={`${ts.n}/${ts.d}`}>
              {`${ts.n}/${ts.d}`}
            </option>
          ))}
          {!TIME_SIGNATURES.some((ts) => ts.n === sig.numerator && ts.d === sig.denominator) ? (
            <option value={sigLabel(sig.numerator, sig.denominator)}>
              {sigLabel(sig.numerator, sig.denominator)}
            </option>
          ) : null}
        </select>
      </label>
    </div>
  );
}

/** Commit-on-enter/blur tempo input (avoids one undo entry per keystroke). */
function TempoField({ value, onCommit }: { value: number; onCommit: (bpm: number) => void }) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);

  const commit = (): void => {
    const bpm = Math.min(400, Math.max(20, Math.round(Number(text))));
    if (Number.isFinite(bpm) && bpm !== value) onCommit(bpm);
    else setText(String(value));
  };

  return (
    <input
      className="field-input"
      type="number"
      min={20}
      max={400}
      value={text}
      onFocus={() => {
        setFocused(true);
      }}
      onChange={(e) => {
        setText(e.target.value);
      }}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          commit();
          (e.target as HTMLInputElement).blur();
        }
      }}
      aria-label="Tempo (BPM)"
    />
  );
}
