import * as alphaTab from "@coderline/alphatab";
import type { Score } from "@stdbd/core";
import { TICKS_PER_QUARTER } from "@stdbd/core";
import type { ClickedPosition, ScoreInteraction, ScorePlayer, ScoreRenderer } from "@stdbd/render";
import { AlphaTabConverter } from "./alpha-tex-converter.js";

/** Renderer rectangle in CSS pixels relative to the score container. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** alphaTab's internal tick resolution: 960 ticks per quarter note. */
const ALPHATAB_TICKS_PER_QUARTER = 960;

/**
 * Concrete ScoreRenderer + ScorePlayer + ScoreInteraction backed by alphaTab.
 * Owns the alphaTab API instance; the app never touches alphaTab directly.
 */
export class AlphaTabRenderer implements ScoreRenderer, ScorePlayer, ScoreInteraction {
  private api: alphaTab.AlphaTabApi | null = null;
  private readonly stateListeners = new Set<(isPlaying: boolean) => void>();
  private readonly clickListeners = new Set<(position: ClickedPosition) => void>();
  private stateHook: (() => void) | null = null;
  private tabStringCount = 6;

  constructor(
    private readonly container: HTMLElement,
    private readonly converter: AlphaTabConverter = new AlphaTabConverter(),
  ) {}

  mount(): void {
    const scrollElement = this.container.closest(".score-scroll");
    this.api = new alphaTab.AlphaTabApi(this.container, {
      core: {
        // alphaTab resolves its default font directory relative to the bundled
        // script, which breaks under Vite dev — point at the served assets.
        fontDirectory: "/font/",
      },
      // dark-theme notation colors — must stay in sync with ui design tokens
      display: {
        resources: {
          mainGlyphColor: "#e8ecf3",
          secondaryGlyphColor: "#aeb8c9",
          staffLineColor: "#4a5568",
          barSeparatorColor: "#4a5568",
          barNumberColor: "#8b95a8",
          scoreInfoColor: "#e8ecf3",
        },
      },
      player: {
        enablePlayer: true,
        soundFont: "/soundfont/sonivox.sf3",
        scrollElement: scrollElement instanceof HTMLElement ? scrollElement : this.container,
      },
    });
    this.attachStateForwarding();
    this.container.addEventListener("pointerdown", this.handlePointerDown);
    // debug/test hook — used by scripts/inspect-page.mjs and E2E tests
    (window as unknown as Record<string, unknown>).__stdbRenderer = this;
  }

  loadScore(score: Score): void {
    if (!this.api) throw new Error("Renderer not mounted — call mount() first");
    const tex = this.converter.convert(score);
    this.api.tex(tex, [0]);
    this.attachStateForwarding();
    this.tabStringCount = score.tracks[0]?.tuning?.strings.length ?? 6;
  }

  play(): void {
    void this.api?.play();
  }

  pause(): void {
    this.api?.pause();
  }

  stop(): void {
    this.api?.stop();
  }

  toggle(): void {
    this.api?.playPause();
  }

  get isPlaying(): boolean {
    return this.api?.player?.state === alphaTab.synth.PlayerState.Playing;
  }

  onStateChange(listener: (isPlaying: boolean) => void): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  onScoreClicked(listener: (position: ClickedPosition) => void): () => void {
    this.clickListeners.add(listener);
    return () => {
      this.clickListeners.delete(listener);
    };
  }

  /** Visual bounds of a master bar (for caret/selection overlays). */
  getBarRect(masterBarIndex: number): Rect | null {
    const masterBar = this.findMasterBar(masterBarIndex);
    if (!masterBar) return null;
    const b = masterBar.visualBounds;
    return { x: b.x, y: b.y, w: b.w, h: b.h };
  }

  dispose(): void {
    this.stateHook?.();
    this.stateHook = null;
    this.container.removeEventListener("pointerdown", this.handlePointerDown);
    this.api?.destroy();
    this.api = null;
    this.stateListeners.clear();
    this.clickListeners.clear();
  }

  private handlePointerDown = (event: PointerEvent): void => {
    const position = this.positionAt(event.clientX, event.clientY);
    if (!position) return;
    for (const listener of this.clickListeners) listener(position);
  };

  /**
   * Resolves a click (client coordinates) to the nearest bar/tick and — when
   * clicking within the tablature staff — the exact string line under the cursor.
   */
  positionAt(clientX: number, clientY: number): ClickedPosition | null {
    const lookup = this.api?.boundsLookup;
    if (!lookup?.isFinished) return null;
    const rect = this.container.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    const system =
      lookup.staffSystems.find(
        (s) => y >= s.realBounds.y && y <= s.realBounds.y + s.realBounds.h,
      ) ?? nearest(lookup.staffSystems, (s) => s.realBounds.y + s.realBounds.h / 2, y);
    if (!system) return null;

    const masterBar =
      system.bars.find(
        (mb) => x >= mb.visualBounds.x && x <= mb.visualBounds.x + mb.visualBounds.w,
      ) ?? nearest(system.bars, (mb) => mb.visualBounds.x + mb.visualBounds.w / 2, x);
    if (!masterBar) return null;

    // the tablature staff renders below the notation staff
    const tabBar = [...masterBar.bars].sort((a, b) => a.realBounds.y - b.realBounds.y).at(-1);
    if (!tabBar) return null;

    const beatBounds =
      tabBar.beats.find(
        (bb) => x >= bb.realBounds.x && x <= bb.realBounds.x + bb.realBounds.w,
      ) ?? nearest(tabBar.beats, (bb) => bb.realBounds.x + bb.realBounds.w / 2, x);
    if (!beatBounds) return null;

    const tick = Math.max(
      0,
      Math.round((beatBounds.beat.displayStart * TICKS_PER_QUARTER) / ALPHATAB_TICKS_PER_QUARTER),
    );

    // tab staff line geometry: the string lines are vertically centered in the
    // staff bounds, spaced oneStaffSpace apart
    const strings = this.tabStringCount;
    const spacing = this.staffSpacePx();
    const bounds = tabBar.realBounds;
    const lineBlockHeight = (strings - 1) * spacing;
    const topLineY = bounds.y + (bounds.h - lineBlockHeight) / 2;
    const withinTab =
      y >= bounds.y - spacing && y <= bounds.y + bounds.h + spacing;
    const stringIndex = withinTab
      ? Math.min(strings - 1, Math.max(0, Math.round((y - topLineY) / spacing)))
      : null;

    return { barIndex: masterBar.index, tick, stringIndex };
  }

  private staffSpacePx(): number {
    const api = this.api;
    if (!api) return 9;
    const space = api.settings.display.resources.engravingSettings.oneStaffSpace;
    return space * api.settings.display.scale;
  }

  private findMasterBar(
    masterBarIndex: number,
  ): alphaTab.rendering.MasterBarBounds | null {
    const lookup = this.api?.boundsLookup;
    if (!lookup) return null;
    for (const system of lookup.staffSystems) {
      for (const masterBar of system.bars) {
        if (masterBar.index === masterBarIndex) return masterBar;
      }
    }
    return null;
  }

  /**
   * The synth player is created lazily by alphaTab; (re)attach forwarding
   * whenever it becomes available. Idempotent.
   */
  private attachStateForwarding(): void {
    const player = this.api?.player;
    if (!player || this.stateHook) return;
    const handler = (args: { state: alphaTab.synth.PlayerState }): void => {
      const playing = args.state === alphaTab.synth.PlayerState.Playing;
      for (const listener of this.stateListeners) listener(playing);
    };
    player.stateChanged.on(handler);
    this.stateHook = () => {
      player.stateChanged.off(handler);
    };
  }
}

function nearest<T>(
  items: readonly T[],
  centerOf: (item: T) => number,
  value: number,
): T | null {
  let best: T | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const distance = Math.abs(centerOf(item) - value);
    if (distance < bestDistance) {
      best = item;
      bestDistance = distance;
    }
  }
  return best;
}
