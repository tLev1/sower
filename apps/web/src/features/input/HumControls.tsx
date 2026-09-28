import { type ReactElement } from "react";
import type { HumMode } from "./useHumInput";
import type { HumState } from "@sower/audio";

export interface HumControlsProps {
  readonly state: HumState;
  readonly mode: HumMode;
  readonly level: number;
  readonly heard: number | null;
  readonly previewCount: number;
  readonly isListening: boolean;
  readonly supported: boolean;
  readonly onToggle: () => void;
  readonly onModeChange: (mode: HumMode) => void;
}

const STATE_MESSAGE: Record<HumState, string> = {
  idle: "",
  requesting: "Waiting for the microphone…",
  listening: "",
  denied: "Microphone access was denied",
  unsupported: "This browser has no microphone capture",
  error: "Microphone capture failed",
};

/**
 * Hum / sing input control: start/stop capture, choose whether the sung pitch
 * corrects the selected note or enters a phrase, and read the live pitch +
 * input level while listening.
 */
export function HumControls({
  state,
  mode,
  level,
  heard,
  previewCount,
  isListening,
  supported,
  onToggle,
  onModeChange,
}: HumControlsProps): ReactElement {
  const message = STATE_MESSAGE[state];
  return (
    <div className="hum-controls">
      <button
        type="button"
        className={isListening ? "tool-btn hum-btn on" : "tool-btn hum-btn"}
        onClick={onToggle}
        disabled={!supported}
        aria-pressed={isListening}
        title={
          isListening
            ? "Stop listening and write what you sang"
            : "Hum or sing: correct the selected note, or enter a phrase"
        }
      >
        <span className="hum-dot" aria-hidden="true" />
        {isListening ? "Stop" : "Hum"}
      </button>
      <div className="hum-modes" role="radiogroup" aria-label="Hum input mode">
        <button
          type="button"
          role="radio"
          aria-checked={mode === "correct"}
          className={mode === "correct" ? "hum-mode active" : "hum-mode"}
          onClick={() => { onModeChange("correct"); }}
          title="Sing the pitch the selected note should have"
        >
          Correct
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === "enter"}
          className={mode === "enter" ? "hum-mode active" : "hum-mode"}
          onClick={() => { onModeChange("enter"); }}
          title="Sing a phrase — it is written from the caret on the entry grid"
        >
          Enter
        </button>
      </div>
      {isListening ? (
        <div className="hum-live" aria-live="polite">
          <div className="hum-level" aria-hidden="true">
            <div className="hum-level-fill" style={{ width: `${Math.min(100, Math.round(level * 900))}%` }} />
          </div>
          <span className="hum-pitch">{heard === null ? "—" : midiName(heard)}</span>
          {previewCount > 0 ? <span className="hum-count">{previewCount} notes</span> : null}
        </div>
      ) : message ? (
        <span className="hum-message">{message}</span>
      ) : null}
    </div>
  );
}

function midiName(midi: number): string {
  const names = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  return `${names[((midi % 12) + 12) % 12] ?? "?"}${Math.floor(midi / 12) - 1}`;
}
