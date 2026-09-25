import type { Score } from "@stdbd/core";
import type {
  ClickedPosition,
  ContextMenuRequest,
  ScoreInteraction,
  ScorePlayer,
  ScoreRenderer,
  SheetMarkerClick,
} from "../renderer.js";
import {
  absoluteTickOfBar,
  barRectAt,
  caretAnchor,
  computeLayout,
  playheadAnchorAt,
  positionAt,
  type LayoutDocument,
} from "./layout.js";
import { engrave, markerHitAreas } from "./engraving.js";
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
  private positionHook: (() => void) | null = null;
  private caret: CaretPosition | null = null;
  private playhead:
    | { readonly barIndex: number; readonly tick: number; readonly absTick?: number }
    | null = null;
  private lastDynMarkup = "";
  private lastScrollTarget = -1;
  private resizeObserver: ResizeObserver | null = null;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly clickListeners = new Set<(position: ClickedPosition) => void>();
  private readonly appendBarListeners = new Set<() => void>();
  private readonly removeBarListeners = new Set<() => void>();
  private readonly sheetMarkerListeners = new Set<(click: SheetMarkerClick) => void>();
  private readonly contextMenuListeners = new Set<(request: ContextMenuRequest) => void>();
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressFired: { readonly x: number; readonly y: number; readonly at: number } | null = null;
  private suppressClickUntil = 0;

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
    overlay.addEventListener("click", this.handleOverlayClick);

    this.resizeObserver = new ResizeObserver(() => {
      if (this.resizeTimer) clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => {
        this.resizeTimer = null;
        if (this.score) this.relayout();
      }, 90);
    });
    this.resizeObserver.observe(this.container);

    this.container.addEventListener("pointerdown", this.handlePointerDown);
    this.container.addEventListener("contextmenu", this.handleContextMenu);

    // the engine owns the playhead: track playback position internally
    this.positionHook = this.player.onPosition((pos) => {
      this.setPlayhead(
        pos ? { barIndex: pos.barIndex, tick: pos.tick, absTick: pos.absTick } : null,
      );
    });

    void document.fonts.ready.then(() => {
      if (this.score) this.relayout();
    });

    // debug/test hook — used by scripts and E2E
    (window as unknown as Record<string, unknown>).__stdbRenderer = this;
  }

  loadScore(score: Score): void {
    this.score = score;
    this.relayout();
    // tempo / meter edits apply immediately — even mid-playback
    this.player.refreshTimeline();
  }

  dispose(): void {
    this.positionHook?.();
    this.positionHook = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
    this.clearLongPress();
    this.overlaySvg?.removeEventListener("click", this.handleOverlayClick);
    this.container.removeEventListener("pointerdown", this.handlePointerDown);
    this.container.removeEventListener("contextmenu", this.handleContextMenu);
    this.player.dispose();
    this.wrapper?.remove();
    this.wrapper = null;
    this.staticSvg = null;
    this.overlaySvg = null;
    this.layout = null;
    this.caret = null;
    this.playhead = null;
    this.clickListeners.clear();
    this.appendBarListeners.clear();
    this.removeBarListeners.clear();
    this.sheetMarkerListeners.clear();
    this.contextMenuListeners.clear();
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
  setPlayhead(position:
    | { readonly barIndex: number; readonly tick: number; readonly absTick?: number }
    | null): void {
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

  /** Subscribes to clicks on the "+" (append measure) button. */
  onAppendBarClicked(listener: () => void): () => void {
    this.appendBarListeners.add(listener);
    return () => {
      this.appendBarListeners.delete(listener);
    };
  }

  /** Subscribes to clicks on the "−" (remove measure) button. */
  onRemoveBarClicked(listener: () => void): () => void {
    this.removeBarListeners.add(listener);
    return () => {
      this.removeBarListeners.delete(listener);
    };
  }

  /** Subscribes to clicks on editable sheet marks (time signature / tempo). */
  onSheetMarkerClicked(listener: (click: SheetMarkerClick) => void): () => void {
    this.sheetMarkerListeners.add(listener);
    return () => {
      this.sheetMarkerListeners.delete(listener);
    };
  }

  /**
   * Subscribes to score-context-menu requests: right-click on desktop,
   * long-press (~550 ms) on touch devices. The request carries the score
   * position and client point the menu should be anchored to.
   */
  onContextMenu(listener: (request: ContextMenuRequest) => void): () => void {
    this.contextMenuListeners.add(listener);
    return () => {
      this.contextMenuListeners.delete(listener);
    };
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

  /** Toggles the click track (metronome). */
  setMetronome(on: boolean): void {
    this.player.setMetronome(on);
  }

  get isMetronomeOn(): boolean {
    return this.player.isMetronomeOn;
  }

  /**
   * Pre-arms audio (context + pluck buffers) from a user gesture so pressing
   * play produces sound with near-zero latency.
   */
  prewarm(): void {
    this.player.prewarm();
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
      // split layers: measure buttons are static per layout; caret/playhead
      // update per frame without touching them (no hover flicker)
      overlay.innerHTML = '<g class="stdb-btns"></g><g class="stdb-dyn"></g>';
      const btns = overlay.querySelector(".stdb-btns");
      if (btns instanceof SVGGElement) btns.innerHTML = this.measureButtonsMarkup();
    }
    this.lastDynMarkup = "";
    this.lastScrollTarget = -1;
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
    const dyn = overlay.querySelector(".stdb-dyn");
    if (!(dyn instanceof SVGGElement)) return;
    let markup = "";
    if (this.playhead) {
      const absTick = this.playhead.absTick ??
        absoluteTickOfBar(this.score ?? layout.score, this.playhead.barIndex) + this.playhead.tick;
      const anchor = playheadAnchorAt(layout, absTick);
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
    if (markup === this.lastDynMarkup) return;
    this.lastDynMarkup = markup;
    dyn.innerHTML = markup;
    this.autoScroll();
  }

  /**
   * Keeps the playhead visible while playing: systems always fit the view
   * width, so scrolling is vertical only — smooth, and only re-issued when
   * the target moves meaningfully (no jitter at frame rate).
   */
  private autoScroll(): void {
    if (!this.playhead || !this.layout) return;
    const absTick = this.playhead.absTick ??
      absoluteTickOfBar(this.score ?? this.layout.score, this.playhead.barIndex) + this.playhead.tick;
    const anchor = playheadAnchorAt(this.layout, absTick);
    const scroller = this.container.closest(".score-scroll");
    if (!anchor || !(scroller instanceof HTMLElement)) return;
    const st = scroller.scrollTop;
    const view = scroller.clientHeight;
    if (anchor.top < st + 40 || anchor.bottom > st + view - 60) {
      const target = Math.max(0, anchor.top - view * 0.35);
      if (Math.abs(target - this.lastScrollTarget) > 24) {
        scroller.scrollTo({ top: target, behavior: "smooth" });
        this.lastScrollTarget = target;
      }
    }
  }

  /** Small +/− controls after the final barline + editable-mark hit areas. */
  private measureButtonsMarkup(): string {
    const layout = this.layout;
    if (!layout) return "";
    const parts: string[] = [this.barButtonsMarkup(layout)];
    for (const area of markerHitAreas(layout)) {
      parts.push(
        `<rect data-stdb-action="${area.action}" data-bar="${area.barIndex}"` +
          ` x="${round2(area.x)}" y="${round2(area.y)}" width="${round2(Math.max(area.w, 8))}" height="${round2(Math.max(area.h, 8))}"` +
          ` fill="transparent" class="stdb-marker-hit" />`,
      );
    }
    return parts.join("");
  }

  private barButtonsMarkup(layout: LayoutDocument): string {
    const lastSystem = layout.systems[layout.systems.length - 1];
    const lastBar = lastSystem?.bars[lastSystem.bars.length - 1];
    const tb = lastBar?.tracks[0];
    if (!lastSystem || !lastBar || !tb) return "";
    const top = tb.notation ? tb.staffTop : tb.tabTop;
    const bottom = tb.tab && tb.stringCount > 0
      ? tb.tabTop + (tb.stringCount - 1) * layout.tabLineGap
      : tb.staffTop + layout.staffSpace * 4;
    const cy = (top + bottom) / 2;
    const r = 10.5;
    const spacing = 2 * r + 8;
    const multiple = layout.score.bars.length > 1;
    const buttons: string[] = [];
    const draw = (cx: number, label: string, action: string, accent: string): string =>
      `<g data-stdb-action="${action}" class="stdb-bar-btn">` +
      `<rect class="stdb-btn-bg" x="${round2(cx - r)}" y="${round2(cy - r)}" width="${round2(2 * r)}" height="${round2(2 * r)}" rx="${r}"` +
      ` fill="#1c2330" stroke="#2a3342" stroke-width="1" />` +
      `<text x="${round2(cx)}" y="${round2(cy + 5)}" font-family="Inter Variable, Inter, sans-serif" font-size="15"` +
      ` font-weight="600" fill="${accent}" text-anchor="middle">${label}</text></g>`;
    let cx = lastBar.x1 + 14 + r;
    if (multiple) {
      buttons.push(draw(cx, "−", "remove-bar", "#8b95a8"));
      cx += spacing;
    }
    buttons.push(draw(cx, "+", "add-bar", "#4f8cff"));
    return buttons.join("");
  }

  private handleOverlayClick = (event: MouseEvent): void => {
    if (performance.now() < this.suppressClickUntil) return; // released a long-press
    const target = event.target;
    if (!(target instanceof Element)) return;
    const actionEl = target.closest("[data-stdb-action]");
    if (!actionEl) return;
    const action = actionEl.getAttribute("data-stdb-action");
    event.preventDefault();
    if (action === "add-bar") {
      for (const listener of [...this.appendBarListeners]) listener();
    } else if (action === "remove-bar") {
      for (const listener of [...this.removeBarListeners]) listener();
    } else if (action === "edit-time-sig" || action === "edit-tempo") {
      const barIndex = Number(actionEl.getAttribute("data-bar") ?? "0");
      if (!Number.isFinite(barIndex)) return;
      const click: SheetMarkerClick = {
        action,
        barIndex,
        clientX: event.clientX,
        clientY: event.clientY,
      };
      for (const listener of [...this.sheetMarkerListeners]) listener(click);
    }
  };

  private handlePointerDown = (event: PointerEvent): void => {
    // measure buttons handle their own clicks — don't reposition the caret
    // (re-rendering the overlay here would destroy the button mid-click)
    if (event.target instanceof Element && event.target.closest("[data-stdb-action]")) return;
    // a touch on the score is a user gesture — pre-arm audio for instant play
    this.player.prewarm();
    if (event.button !== 0) return;
    if (event.pointerType === "touch" && event.isPrimary) this.armLongPress(event);
    const position = this.positionAt(event.clientX, event.clientY);
    if (!position) return;
    for (const listener of this.clickListeners) listener(position);
  };

  // -- context menu (right-click / long-press) ---------------------------------------

  private handleContextMenu = (event: MouseEvent): void => {
    event.preventDefault(); // premium sheets own their context menu
    this.player.prewarm();
    // a long-press that just opened the menu re-fires as a native contextmenu — skip
    const fired = this.longPressFired;
    if (
      fired &&
      performance.now() - fired.at < 800 &&
      Math.abs(fired.x - event.clientX) < 24 &&
      Math.abs(fired.y - event.clientY) < 24
    ) {
      return;
    }
    this.openContextMenu(event.clientX, event.clientY);
  };

  private armLongPress(event: PointerEvent): void {
    this.clearLongPress();
    this.longPressTimer = setTimeout(() => {
      this.longPressTimer = null;
      this.longPressFired = { x: event.clientX, y: event.clientY, at: performance.now() };
      this.suppressClickUntil = performance.now() + 400;
      this.openContextMenu(event.clientX, event.clientY);
    }, 550);
    const cancel = (): void => {
      this.clearLongPress();
    };
    window.addEventListener("pointermove", cancel, { once: true });
    window.addEventListener("pointerup", cancel, { once: true });
    window.addEventListener("pointercancel", cancel, { once: true });
  }

  private clearLongPress(): void {
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  private openContextMenu(clientX: number, clientY: number): void {
    const position = this.positionAt(clientX, clientY);
    if (!position) return;
    const request: ContextMenuRequest = {
      barIndex: position.barIndex,
      tick: position.tick,
      stringIndex: position.stringIndex,
      clientX,
      clientY,
    };
    for (const listener of [...this.contextMenuListeners]) listener(request);
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
