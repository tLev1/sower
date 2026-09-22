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
