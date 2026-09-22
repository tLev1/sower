import type { Score } from "@stdbd/core";

/**
 * Adapter contract for score rendering. Implementations live in
 * packages/render/* — the core app never imports alphaTab (or any renderer)
 * directly.
 */
export interface ScoreRenderer {
  /** Mount the renderer into a container element and display the score. */
  mount(container: HTMLElement): void;
  /** Display a score (already converted to the renderer's native format). */
  loadScore(score: Score): void;
  /** Destroy and release resources. */
  dispose(): void;
}

/** Converts our core Score model into a renderer's native format. */
export interface ScoreConverter<TNative = unknown> {
  convert(score: Score): TNative;
}

/** Transport controls for score playback. Sound engine behind the adapter. */
export interface ScorePlayer {
  play(): void;
  pause(): void;
  stop(): void;
  toggle(): void;
  get isPlaying(): boolean;
  /** Subscribes to play/pause changes; returns unsubscribe function. */
  onStateChange(listener: (isPlaying: boolean) => void): () => void;
}

/** A click position on the score, mapped into core-model coordinates. */
export interface ClickedPosition {
  readonly barIndex: number;
  /** Tick within the bar in core-model resolution (480 per quarter). */
  readonly tick: number;
  /** Visual string index (0 = highest) when the click hit a fretted note. */
  readonly stringIndex: number | null;
}

/** Mouse interaction with the rendered score. */
export interface ScoreInteraction {
  /**
   * Subscribes to clicks anywhere on the score; the position is resolved to
   * the nearest bar/tick and (when clicking within the tab staff) the exact
   * string line. Returns unsubscribe function.
   */
  onScoreClicked(listener: (position: ClickedPosition) => void): () => void;
}
