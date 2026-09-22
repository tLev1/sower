import { AlphaTabApi } from "@coderline/alphatab";
import type { Score } from "@stdbd/core";
import type { ScoreRenderer } from "@stdbd/render";
import { AlphaTabConverter } from "./alpha-tex-converter.js";

/**
 * Concrete ScoreRenderer backed by alphaTab.
 * Owns the alphaTab API instance; the app never touches alphaTab directly.
 */
export class AlphaTabRenderer implements ScoreRenderer {
  private api: AlphaTabApi | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly converter: AlphaTabConverter = new AlphaTabConverter(),
  ) {}

  mount(): void {
    this.api = new AlphaTabApi(this.container, {});
  }

  loadScore(score: Score): void {
    if (!this.api) throw new Error("Renderer not mounted — call mount() first");
    const tex = this.converter.convert(score);
    this.api.tex(tex, [0]);
  }

  dispose(): void {
    this.api?.destroy();
    this.api = null;
  }
}
