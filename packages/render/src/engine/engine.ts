import type { Score } from "@stdbd/core";
import type { ClickedPosition, ScoreInteraction, ScorePlayer, ScoreRenderer } from "../renderer.js";
import {
  barRectAt,
  caretAnchor,
  computeLayout,
  playheadAnchor,
  positionAt,
  type LayoutDocument,
} from "./layout.js";
import { engrave } from "./engraving.js";
import { WebAudioPlayer } from "./player.js";
import { engravingTheme } from "./theme.js";

/**
 * The stdBd engraving engine — a from-scratch SVG score renderer.
 *
 * Implements the adapter contracts (ScoreRenderer + ScorePlayer +
 * ScoreInteraction): mounts into a container, lays out and engraves the
 * core Score directly (no intermediate format), resolves clicks to score
 * positions, draws caret/playhead overlays, and drives WebAudio playback.
 */

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface CaretPosition {
  readonly barIndex: number;
  readonly tick: number;
  readonly stringIndex: number;
}

const SVG_NS = "http://www.w3.org/2000/svg";

export class StdbdEngine implements ScoreRenderer, ScorePlayer, ScoreInteraction {
  private readonly container: HTMLElement;
  private wrapper: HTMLDivElement | null = null;
  private staticSvg: SVGSVGElement | null = null;
  private overlaySvg: SVGSVGElement | null = null;
  private score: Score | null = null;
  private layout: LayoutDocument | null = null;
  private readonly player: WebAudioPlayer;
  private caret: CaretPosition | null = null;
  private playhead: { readonly barIndex: number; readonly tick: number } | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly clickListeners = new Set<(position: ClickedPosition) => void>();

  constructor(container: HTMLElement) {
    this.container = container;
    this.player = new WebAudioPlayer(() => this.score);
  }

  // -- ScoreRenderer -----------------------------------------------------------

  mount(): void {
    if (this.wrapper) return;
    const wrapper = document.createElement("div");
    wrapper.className = "stdb-score-wrap";
    const overlay = document.createElementNS(SVG_NS, "svg");
    overlay.classList.add("stdb-score-overlay");
    wrapper.appendChild(overlay);
    this.container.appendChild(wrapper);
    this.wrapper = wrapper;
    this.overlaySvg = overlay;

    this.resizeObserver = new ResizeObserver(() => {
      if (this.resizeTimer) clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => {
        this.resizeTimer = null;
        if (this.score) this.relayout();
      }, 90);
    });
    this.resizeObserver.observe(this.container);

    this.container.addEventListener("pointerdown", this.handlePointerDown);

    void document.fonts.ready.then(() => {
      if (this.score) this.relayout();
    });

    // debug/test hook — used by scripts and E2E
    (window as unknown as Record<string, unknown>).__stdbRenderer = this;
  }

  loadScore(score: Score): void {
    this.score = score;
    this.relayout();
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
    this.container.removeEventListener("pointerdown", this.handlePointerDown);
    this.player.dispose();
    this.wrapper?.remove();
    this.wrapper = null;
    this.staticSvg = null;
    this.overlaySvg = null;
    this.layout = null;
    this.caret = null;
    this.playhead = null;
    this.clickListeners.clear();
    delete (window as unknown as Record<string, unknown>).__stdbRenderer;
  }

  // -- hit-testing / interaction ------------------------------------------------

  /** Client coordinates → core-model position (bar, tick, string). */
  positionAt(clientX: number, clientY: number): ClickedPosition | null {
    const svg = this.staticSvg;
    const layout = this.layout;
    if (!svg || !layout) return null;
    const rect = svg.getBoundingClientRect();
    return positionAt(layout, clientX - rect.left, clientY - rect.top);
  }

  /** Client-space point for a score position (used by tests/E2E). */
  pointFor(position: {
    readonly barIndex: number;
    readonly tick: number;
    readonly stringIndex: number;
  }): { readonly x: number; readonly y: number } | null {
    const layout = this.layout;
    const svg = this.staticSvg;
    if (!layout || !svg) return null;
    const anchor = caretAnchor(layout, position.barIndex, position.tick, position.stringIndex);
    if (!anchor) return null;
    const rect = svg.getBoundingClientRect();
    return { x: rect.left + anchor.x, y: rect.top + anchor.y };
  }

  /** Visual bounds of a bar (compat with the old adapter API). */
  getBarRect(barIndex: number): Rect | null {
    const layout = this.layout;
    return layout ? barRectAt(layout, barIndex) : null;
  }

  onScoreClicked(listener: (position: ClickedPosition) => void): () => void {
    this.clickListeners.add(listener);
    return () => {
      this.clickListeners.delete(listener);
    };
  }

  // -- overlays ------------------------------------------------------------------

  /** Positions the editing caret (thin line + string dot) in the tab staff. */
  setCaret(position: CaretPosition | null): void {
    this.caret = position;
    this.renderOverlays();
  }

  /** Positions the playback playhead (glowing line through the staves). */
  setPlayhead(position: { readonly barIndex: number; readonly tick: number } | null): void {
    this.playhead = position;
    this.renderOverlays();
  }

  /** Sets where playback starts (the caret position). */
  setStartPosition(position: { readonly barIndex: number; readonly tick: number } | null): void {
    this.player.setStartPosition(position);
  }

  /** Subscribes to playback position updates (bar/tick while playing). */
  onPositionChanged(
    listener: (position: { readonly barIndex: number; readonly tick: number } | null) => void,
  ): () => void {
    return this.player.onPosition((pos) => {
      listener(pos ? { barIndex: pos.barIndex, tick: pos.tick } : null);
    });
  }

  // -- ScorePlayer -----------------------------------------------------------------

  play(): void {
    this.player.play();
  }

  pause(): void {
    this.player.pause();
  }

  stop(): void {
    this.player.stop();
  }

  toggle(): void {
    this.player.toggle();
  }

  get isPlaying(): boolean {
    return this.player.isPlaying;
  }

  onStateChange(listener: (isPlaying: boolean) => void): () => void {
    return this.player.onStateChange(listener);
  }

  // -- internals ---------------------------------------------------------------------

  private relayout(): void {
    const score = this.score;
    if (!score || !this.wrapper) return;
    const width = this.container.clientWidth || 960;
    const layout = computeLayout(score, { width });
    this.layout = layout;
    this.renderStatic();
    const overlay = this.overlaySvg;
    if (overlay) {
      const w = Math.round(width);
      const h = Math.round(layout.height);
      overlay.setAttribute("width", String(w));
      overlay.setAttribute("height", String(h));
      overlay.setAttribute("viewBox", `0 0 ${w} ${h}`);
    }
    this.renderOverlays();
  }

  private renderStatic(): void {
    const layout = this.layout;
    const wrapper = this.wrapper;
    if (!layout || !wrapper) return;
    this.staticSvg?.remove();
    this.staticSvg = null;
    const holder = document.createElement("div");
    holder.innerHTML = engrave(layout);
    const svg = holder.firstElementChild;
    if (svg instanceof SVGSVGElement) {
      svg.classList.add("stdb-score-static");
      wrapper.insertBefore(svg, this.overlaySvg);
      this.staticSvg = svg;
    }
  }

  private renderOverlays(): void {
    const overlay = this.overlaySvg;
    const layout = this.layout;
    if (!overlay || !layout) return;
    let markup = "";
    if (this.playhead) {
      const anchor = playheadAnchor(layout, this.playhead.barIndex, this.playhead.tick);
      if (anchor) {
        markup +=
          `<rect x="${round2(anchor.x - 16)}" y="${round2(anchor.top)}" width="32" height="${round2(anchor.bottom - anchor.top)}"` +
          ` fill="${engravingTheme.playheadGlow}" filter="url(#stdb-glow)" opacity="0.85" />` +
          `<line x1="${round2(anchor.x)}" y1="${round2(anchor.top)}" x2="${round2(anchor.x)}" y2="${round2(anchor.bottom)}"` +
          ` stroke="${engravingTheme.playheadColor}" stroke-width="2" stroke-linecap="round" />`;
      }
    }
    if (this.caret) {
      const anchor = caretAnchor(layout, this.caret.barIndex, this.caret.tick, this.caret.stringIndex);
      if (anchor) {
        markup +=
          `<line x1="${round2(anchor.x)}" y1="${round2(anchor.top)}" x2="${round2(anchor.x)}" y2="${round2(anchor.bottom)}"` +
          ` stroke="${engravingTheme.caretColor}" stroke-width="2" stroke-linecap="round" opacity="0.9" />` +
          `<circle cx="${round2(anchor.x)}" cy="${round2(anchor.y)}" r="3.2" fill="${engravingTheme.caretColor}" />`;
      }
    }
    overlay.innerHTML = markup;

    // keep the playhead in view while playing
    if (this.playhead) {
      const anchor = playheadAnchor(layout, this.playhead.barIndex, this.playhead.tick);
      const scroller = this.container.closest(".score-scroll");
      if (anchor && scroller instanceof HTMLElement) {
        const left = scroller.scrollLeft;
        const view = scroller.clientWidth;
        if (anchor.x < left + 70 || anchor.x > left + view - 130) {
          scroller.scrollLeft = Math.max(0, anchor.x - view * 0.35);
        }
      }
    }
  }

  private handlePointerDown = (event: PointerEvent): void => {
    const position = this.positionAt(event.clientX, event.clientY);
    if (!position) return;
    for (const listener of this.clickListeners) listener(position);
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
