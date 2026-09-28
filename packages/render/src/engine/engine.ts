import type { NoteId, Score, Tuning } from "@sower/core";
import {
  MIN_NOTE_TICKS,
  STANDARD_DURATIONS,
  bestFingering,
  durationLabel,
  ticksPerBar,
} from "@sower/core";
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
  beatColumnInfo,
  caretAnchor,
  computeLayout,
  durationEdgeX,
  findNoteInLayout,
  noteBodies,
  noteEdges,
  noteHandleAt,
  pitchAnchorY,
  playheadAnchorAt,
  positionAt,
  staffPosForNote,
  type LayoutDocument,
  type NoteHandleKind,
  type NoteHandleTarget,
} from "./layout.js";
import { engrave, markerHitAreas } from "./engraving.js";
import { WebAudioPlayer } from "./player.js";
import { engravingTheme } from "./theme.js";

/**
 * The Sower engraving engine — a from-scratch SVG score renderer.
 *
 * Implements the adapter contracts (ScoreRenderer + ScorePlayer +
 * ScoreInteraction): mounts into a container, lays out and engraves the
 * core Score directly (no intermediate format), resolves clicks to score
 * positions, draws caret/playhead overlays, and drives WebAudio playback.
 *
 * Direct manipulation (Phase 1c): grabbing a note body and dragging
 * vertically re-pitches it (snapped to whole semitones, re-fingered for the
 * instrument); grabbing its right edge and dragging horizontally resizes its
 * notated duration (snapped to the standard rhythm values). The engine owns
 * the geometry and the live preview; the app applies the domain commands.
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

/** Vertical drag distance that equals one semitone (score pixels). */
export const PX_PER_SEMITONE = 5;

export type NoteDragPhase = "start" | "move" | "end" | "cancel";

/**
 * A direct-manipulation gesture on a note. `pitch`/`string`/`fret` carry the
 * proposed target of a vertical (pitch) drag; `duration` the proposed tick
 * length of a horizontal (edge) drag. Values are already snapped — the
 * listener applies them as domain commands on `end`.
 */
export interface NoteDragEvent {
  readonly phase: NoteDragPhase;
  readonly barIndex: number;
  readonly noteId: NoteId;
  readonly handle: NoteHandleKind;
  readonly pitch?: number;
  readonly string?: number;
  readonly fret?: number;
  readonly duration?: number;
}

const SVG_NS = "http://www.w3.org/2000/svg";

export class SowerEngine implements ScoreRenderer, ScorePlayer, ScoreInteraction {
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
  private readonly noteDragListeners = new Set<(event: NoteDragEvent) => void>();
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressFired: { readonly x: number; readonly y: number; readonly at: number } | null = null;
  private suppressClickUntil = 0;

  /** Live direct-manipulation gesture (null = none in progress). */
  private drag: {
    readonly handle: NoteHandleKind;
    readonly barIndex: number;
    readonly noteId: NoteId;
    readonly pointerId: number;
    readonly startClientX: number;
    readonly startClientY: number;
    readonly startPitch: number;
    readonly startString: number | null;
    readonly startDuration: number;
    moved: boolean;
    /** Axis lock for body drags: vertical = pitch, horizontal = duration. */
    mode: "pitch" | "duration" | null;
    proposal: NoteDragEvent | null;
  } | null = null;
  private dragMarkup = "";
  private hoverRaf = 0;
  private lastHoverPoint: { readonly x: number; readonly y: number } | null = null;

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
    this.container.addEventListener("pointermove", this.handlePointerMove);
    this.container.addEventListener("pointerleave", this.handlePointerLeave);
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
    (window as unknown as Record<string, unknown>).__sowerRenderer = this;
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
    this.cancelDrag(true);
    if (this.hoverRaf) {
      cancelAnimationFrame(this.hoverRaf);
      this.hoverRaf = 0;
    }
    this.overlaySvg?.removeEventListener("click", this.handleOverlayClick);
    this.container.removeEventListener("pointerdown", this.handlePointerDown);
    this.container.removeEventListener("pointermove", this.handlePointerMove);
    this.container.removeEventListener("pointerleave", this.handlePointerLeave);
    this.container.removeEventListener("contextmenu", this.handleContextMenu);
    window.removeEventListener("pointermove", this.handleDragMove);
    window.removeEventListener("pointerup", this.handleDragUp);
    window.removeEventListener("pointercancel", this.handleDragCancel);
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
    this.noteDragListeners.clear();
    delete (window as unknown as Record<string, unknown>).__sowerRenderer;
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

  /**
   * Test/E2E hook: the client-space grab points of a note — its body (pitch /
   * duration drag) and its duration edge. Returns null when the note is not
   * laid out.
   */
  noteGrabPoints(
    barIndex: number,
    noteId: NoteId,
  ): { readonly body: { readonly x: number; readonly y: number } | null; readonly edge: { readonly x: number; readonly y: number } | null } | null {
    const layout = this.layout;
    const svg = this.staticSvg;
    if (!layout || !svg) return null;
    const rect = svg.getBoundingClientRect();
    const bodies = noteBodies(layout).filter((b) => b.barIndex === barIndex && b.noteId === noteId);
    const tab = bodies.find((b) => b.onTab) ?? bodies[0] ?? null;
    const edge = noteEdges(layout).find((e) => e.barIndex === barIndex && e.noteId === noteId) ?? null;
    return {
      body: tab ? { x: rect.left + tab.x, y: rect.top + tab.y } : null,
      edge: edge
        ? { x: rect.left + edge.x, y: rect.top + (edge.top + edge.bottom) / 2 }
        : null,
    };
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

  /**
   * Subscribes to direct-manipulation gestures on notes: dragging a note body
   * vertically re-pitches it, dragging its right edge horizontally resizes
   * its notated duration. Emits the snapped proposal on every move and a
   * final one on release (or `cancel` when the gesture is aborted / the
   * pointer never actually moved — that resolves to a plain caret click).
   */
  onNoteDrag(listener: (event: NoteDragEvent) => void): () => void {
    this.noteDragListeners.add(listener);
    return () => {
      this.noteDragListeners.delete(listener);
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
    // measure the CONTENT box (the wrapper sits inside the scroll container's
    // padding) — using the padded clientWidth made the score overflow the
    // page margins and produce a horizontal scrollbar
    const width = this.wrapper.clientWidth || this.container.clientWidth || 960;
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
      // update per frame without touching them (no hover flicker); the drag
      // preview lives in its own group so neither memo is disturbed
      overlay.innerHTML = '<g class="stdb-btns"></g><g class="stdb-dyn"></g><g class="stdb-drag"></g>';
      const btns = overlay.querySelector(".stdb-btns");
      if (btns instanceof SVGGElement) btns.innerHTML = this.measureButtonsMarkup();
      this.dragMarkup = "";
      const dragLayer = overlay.querySelector(".stdb-drag");
      if (dragLayer instanceof SVGGElement) dragLayer.innerHTML = "";
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
    } else if (action === "edit-time-sig" || action === "edit-tempo" || action === "edit-title" || action === "edit-author") {
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
    const svgPoint = this.svgPoint(event.clientX, event.clientY);
    const layout = this.layout;
    const hit = svgPoint && layout ? noteHandleAt(layout, svgPoint.x, svgPoint.y) : null;
    if (hit && layout) {
      // grabbing a note body or its duration edge arms a drag; a release
      // without movement still resolves to the normal caret click
      this.clearLongPress();
      const found = findNoteInLayout(layout, hit.barIndex, hit.noteId);
      if (!found) return;
      this.drag = {
        handle: hit.handle,
        barIndex: hit.barIndex,
        noteId: hit.noteId,
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startPitch: found.note.pitch,
        startString: found.note.string,
        startDuration: found.note.duration,
        moved: false,
        mode: null,
        proposal: null,
      };
      window.addEventListener("pointermove", this.handleDragMove);
      window.addEventListener("pointerup", this.handleDragUp);
      window.addEventListener("pointercancel", this.handleDragCancel);
      return;
    }
    if (event.pointerType === "touch" && event.isPrimary) this.armLongPress(event);
    const position = this.positionAt(event.clientX, event.clientY);
    if (!position) return;
    for (const listener of this.clickListeners) listener(position);
  };

  // -- direct manipulation (drag pitch / drag duration edge) ----------------------

  private svgPoint(clientX: number, clientY: number): { x: number; y: number } | null {
    const svg = this.staticSvg;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  private handlePointerMove = (event: PointerEvent): void => {
    if (this.drag) return; // drag moves are handled globally (capture-free)
    if (this.hoverRaf) return;
    this.lastHoverPoint = { x: event.clientX, y: event.clientY };
    this.hoverRaf = requestAnimationFrame(() => {
      this.hoverRaf = 0;
      const point = this.lastHoverPoint;
      const layout = this.layout;
      if (!point || !layout) return;
      const svgPoint = this.svgPoint(point.x, point.y);
      const hit = svgPoint ? noteHandleAt(layout, svgPoint.x, svgPoint.y) : null;
      // affordance on hover: a grip at the note's duration edge, or a ring
      // around its body — the note is grabbable in both axes
      this.container.style.cursor = hit ? (hit.handle === "edge" ? "ew-resize" : "move") : "";
      this.renderHover(hit);
    });
  };

  /** Subtle hover affordance for the note handle under the pointer. */
  private renderHover(hit: NoteHandleTarget | null): void {
    const layout = this.layout;
    const overlay = this.overlaySvg;
    if (!layout || !overlay) return;
    const layer = overlay.querySelector(".stdb-drag");
    if (!(layer instanceof SVGGElement)) return;
    if (!hit) {
      if (this.dragMarkup !== "") {
        this.dragMarkup = "";
        layer.innerHTML = "";
      }
      return;
    }
    const theme = engravingTheme;
    const markup =
      hit.handle === "edge"
        ? `<rect x="${round2(hit.x - 2.5)}" y="${round2(hit.y - 13)}" width="5" height="26" rx="2.5"` +
          ` fill="${theme.caretColor}" opacity="0.85" />`
        : `<rect x="${round2(hit.x - 13)}" y="${round2(hit.y - 11)}" width="26" height="22" rx="6"` +
          ` fill="${theme.caretColor}" opacity="0.16" stroke="${theme.caretColor}" stroke-width="1.2" />`;
    if (markup === this.dragMarkup) return;
    this.dragMarkup = markup;
    layer.innerHTML = markup;
  }

  private handlePointerLeave = (): void => {
    if (this.drag) return;
    this.container.style.cursor = "";
    this.renderHover(null);
  };

  private handleDragMove = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startClientX;
    const dy = event.clientY - drag.startClientY;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    if (!drag.moved) {
      drag.moved = true;
      // axis lock: a body drag goes vertical (pitch) or horizontal (duration)
      if (drag.handle === "body") {
        drag.mode = Math.abs(dy) >= Math.abs(dx) ? "pitch" : "duration";
      } else {
        drag.mode = "duration";
      }
    }
    this.container.style.cursor =
      drag.mode === "duration" ? "ew-resize" : drag.handle === "edge" ? "ew-resize" : "ns-resize";
    const proposal = this.proposeDrag(event.clientX, event.clientY);
    drag.proposal = proposal;
    if (!proposal) return;
    this.renderDragPreview(proposal);
    for (const listener of [...this.noteDragListeners]) listener(proposal);
  };

  private handleDragUp = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const moved = drag.moved;
    const proposal = drag.proposal;
    const start = { x: drag.startClientX, y: drag.startClientY };
    this.drag = null;
    window.removeEventListener("pointermove", this.handleDragMove);
    window.removeEventListener("pointerup", this.handleDragUp);
    window.removeEventListener("pointercancel", this.handleDragCancel);
    this.clearDragPreview();
    this.container.style.cursor = "";
    if (moved && proposal) {
      for (const listener of [...this.noteDragListeners]) listener({ ...proposal, phase: "end" });
      return;
    }
    // no movement: a plain click — reposition the caret (unless a long-press
    // context menu just fired on this gesture)
    if (performance.now() < this.suppressClickUntil) return;
    const position = this.positionAt(start.x, start.y);
    if (!position) return;
    for (const listener of this.clickListeners) listener(position);
  };

  private handleDragCancel = (): void => {
    this.cancelDrag(false);
  };

  /** Aborts a drag; `silent` skips the cancel event (used on dispose). */
  private cancelDrag(silent: boolean): void {
    const drag = this.drag;
    window.removeEventListener("pointermove", this.handleDragMove);
    window.removeEventListener("pointerup", this.handleDragUp);
    window.removeEventListener("pointercancel", this.handleDragCancel);
    this.clearDragPreview();
    this.container.style.cursor = "";
    if (!drag) return;
    this.drag = null;
    if (silent) return;
    const proposal = drag.proposal ?? {
      phase: "cancel" as const,
      barIndex: drag.barIndex,
      noteId: drag.noteId,
      handle: drag.handle,
    };
    for (const listener of [...this.noteDragListeners]) listener({ ...proposal, phase: "cancel" });
  }

  /**
   * Snapped target of the gesture under the pointer. A vertical drag moves
   * the note by whole semitones and re-fingers it for the instrument; a
   * horizontal drag (or a grab on the duration edge) snaps the note's length
   * to the standard rhythm value whose drawn edge lands nearest the pointer,
   * clamped so the gesture never overwrites the notes after it (the owner's
   * spec: only this note changes).
   */
  private proposeDrag(clientX: number, clientY: number): NoteDragEvent | null {
    const drag = this.drag;
    const layout = this.layout;
    const score = this.score;
    if (!drag || !layout || !score) return null;
    const found = findNoteInLayout(layout, drag.barIndex, drag.noteId);
    if (!found) return null;
    const svgPoint = this.svgPoint(clientX, clientY);
    if (!svgPoint) return null;
    const wantsDuration = drag.mode === "duration";

    if (!wantsDuration) {
      const dy = drag.startClientY - clientY;
      const semis = Math.round(dy / PX_PER_SEMITONE);
      const pitch = Math.min(127, Math.max(0, drag.startPitch + semis));
      const tuning: Tuning | null = score.tracks[0]?.tuning ?? null;
      if (!tuning) {
        return {
          phase: "move",
          barIndex: drag.barIndex,
          noteId: drag.noteId,
          handle: "body",
          pitch,
        };
      }
      const fingering = bestFingering(tuning, pitch, drag.startString);
      return {
        phase: "move",
        barIndex: drag.barIndex,
        noteId: drag.noteId,
        handle: "body",
        pitch: fingering.pitch,
        string: fingering.string,
        fret: fingering.fret,
      };
    }

    // duration: never run past the next written event in the measure
    const voice = found.bar.bar.voices[0];
    const capacity = ticksPerBar(found.bar.bar.timeSignature);
    let limit = capacity - found.note.start;
    for (const n of voice?.notes ?? []) {
      if (n.id === drag.noteId) continue;
      if (n.start > found.note.start) limit = Math.min(limit, n.start - found.note.start);
    }
    for (const r of voice?.rests ?? []) {
      if (r.start > found.note.start) limit = Math.min(limit, r.start - found.note.start);
    }
    const maxTicks = Math.max(MIN_NOTE_TICKS, limit);
    let best = Math.min(Math.max(MIN_NOTE_TICKS, drag.startDuration), maxTicks);
    let bestDist = Math.abs(durationEdgeX(layout, found.beat, best) - svgPoint.x);
    for (const value of STANDARD_DURATIONS) {
      if (value < MIN_NOTE_TICKS || value > maxTicks) continue;
      const dist = Math.abs(durationEdgeX(layout, found.beat, value) - svgPoint.x);
      if (dist < bestDist) {
        best = value;
        bestDist = dist;
      }
    }
    return {
      phase: "move",
      barIndex: drag.barIndex,
      noteId: drag.noteId,
      handle: "edge",
      duration: best,
    };
  }

  /** Live ghost of where the note will land while the pointer is down. */
  private renderDragPreview(proposal: NoteDragEvent): void {
    const layout = this.layout;
    const overlay = this.overlaySvg;
    if (!layout || !overlay) return;
    const layer = overlay.querySelector(".stdb-drag");
    if (!(layer instanceof SVGGElement)) return;
    const found = findNoteInLayout(layout, proposal.barIndex, proposal.noteId);
    if (!found) return;
    const S = layout.staffSpace;
    const parts: string[] = [];
    const theme = engravingTheme;

    if (proposal.handle === "body" && proposal.pitch !== undefined) {
      const bodyX = found.beat.x;
      const note = found.note;
      const targetString = proposal.string ?? note.string;
      const targetFret = proposal.fret ?? note.fret;
      const tabY = pitchAnchorY(layout, proposal.barIndex, proposal.pitch, targetString);
      const drag = this.drag;
      // vertical guide from the note's original body to the target
      const originalY = pitchAnchorY(layout, proposal.barIndex, drag?.startPitch ?? note.pitch, note.string);
      if (originalY !== null && tabY !== null && Math.abs(originalY - tabY) > 0.5) {
        parts.push(
          `<line x1="${round2(bodyX)}" y1="${round2(originalY)}" x2="${round2(bodyX)}" y2="${round2(tabY)}"` +
            ` stroke="${theme.caretColor}" stroke-width="1.5" stroke-dasharray="3 3" opacity="0.55" />`,
        );
      }
      if (tabY !== null && targetString !== null && targetFret !== null) {
        parts.push(
          `<circle cx="${round2(bodyX)}" cy="${round2(tabY)}" r="9.5" fill="${theme.playheadGlow}" opacity="0.9" />` +
            `<text x="${round2(bodyX)}" y="${round2(tabY + 4.8)}" font-family="JetBrains Mono Variable, 'JetBrains Mono', Consolas, monospace"` +
            ` font-size="13.5" font-weight="500" fill="${theme.caretColor}" text-anchor="middle"` +
            ` class="stdb-drag-fret">${String(targetFret)}</text>`,
        );
      }
      // ghost notehead on the notation staff
      if (found.trackBar.notation) {
        const isGuitar = note.string !== null && note.fret !== null;
        const pos = staffPosForNote(proposal.pitch, isGuitar);
        const notationY = found.trackBar.staffTop + S * 2 - pos * (S / 2);
        parts.push(
          `<circle cx="${round2(bodyX)}" cy="${round2(notationY)}" r="${round2(S * 0.95)}"` +
            ` fill="none" stroke="${theme.caretColor}" stroke-width="1.8" opacity="0.75" />`,
        );
      }
    } else if (proposal.handle === "edge" && proposal.duration !== undefined) {
      const { left } = beatColumnInfo(layout, found.beat);
      const edgeX = durationEdgeX(layout, found.beat, proposal.duration);
      const bodyY = pitchAnchorY(layout, proposal.barIndex, found.note.pitch, found.note.string);
      const midY = bodyY ?? found.trackBar.staffTop + S * 2;
      const top = midY - S * 3.6;
      const bottom = midY + S * 3.6;
      parts.push(
        `<rect x="${round2(left)}" y="${round2(top)}" width="${round2(Math.max(edgeX - left, 1))}"` +
          ` height="${round2(bottom - top)}" fill="${theme.playheadGlow}" opacity="0.3" rx="3" />` +
          `<line x1="${round2(edgeX)}" y1="${round2(top)}" x2="${round2(edgeX)}" y2="${round2(bottom)}"` +
          ` stroke="${theme.caretColor}" stroke-width="2.5" stroke-linecap="round" />`,
      );
      const label = durationLabel(proposal.duration);
      const chipW = Math.max(30, label.length * 8.2 + 12);
      const chipY = top - 20;
      parts.push(
        `<rect x="${round2(edgeX - chipW / 2)}" y="${round2(chipY)}" width="${round2(chipW)}" height="19" rx="9.5"` +
          ` fill="#11151c" stroke="${theme.caretColor}" stroke-width="1" opacity="0.95" />` +
          `<text x="${round2(edgeX)}" y="${round2(chipY + 13.5)}" font-family="Inter Variable, Inter, sans-serif"` +
          ` font-size="12" font-weight="600" fill="${theme.caretColor}" text-anchor="middle">${label}</text>`,
      );
    }

    const markup = parts.join("");
    if (markup === this.dragMarkup) return;
    this.dragMarkup = markup;
    layer.innerHTML = markup;
  }

  private clearDragPreview(): void {
    this.dragMarkup = "";
    const overlay = this.overlaySvg;
    if (!overlay) return;
    const layer = overlay.querySelector(".stdb-drag");
    if (layer instanceof SVGGElement) layer.innerHTML = "";
  }

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
