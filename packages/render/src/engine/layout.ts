import type { Bar, Note, Score, Track } from "@stdbd/core";
import { TICKS_PER_QUARTER, ticksPerBar } from "@stdbd/core";

/**
 * Pure layout engine: turns a core Score into geometry (systems, bars, beats,
 * staff/tab positions). No DOM — fully unit-testable. Both the SVG engraver
 * and hit-testing consume this module.
 */

/** One staff space in CSS pixels at scale 1 (controls overall density). */
export const STAFF_SPACE = 10;
/** Vertical distance between two tablature string lines, in CSS pixels. */
export const TAB_LINE_GAP = 9;

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface LayoutParams {
  /** Available content width in CSS pixels. */
  readonly width: number;
  /** Extra horizontal padding inside each system. */
  readonly padding?: number;
}

/** A rhythmic column: all notes starting at the same tick (or a rest). */
export interface Beat {
  /** Tick within the bar. */
  readonly start: number;
  /** Duration in ticks. */
  readonly duration: number;
  readonly notes: readonly Note[];
  readonly isRest: boolean;
  /** Center x of this beat column (absolute, SVG coordinates). */
  readonly x: number;
  /** Full column width (notehead + spacing). */
  readonly width: number;
  /** Id of the beam group this beat belongs to, or -1. */
  readonly beamId: number;
}

/** One track's laid-out bar content inside a system. */
export interface TrackBar {
  readonly trackIndex: number;
  readonly track: Track;
  readonly beats: readonly Beat[];
  /** Renders a 5-line notation staff. */
  readonly notation: boolean;
  /** Renders a tablature staff. */
  readonly tab: boolean;
  /** Top staff line y of the notation staff (absolute). */
  readonly staffTop: number;
  /** Top string line y of the tab staff (absolute). */
  readonly tabTop: number;
  readonly stringCount: number;
}

/** One logical bar as laid out inside a system. */
export interface BarBox {
  readonly index: number;
  readonly bar: Bar;
  /** Left edge (absolute x) — where the previous barline sits. */
  readonly x0: number;
  /** Right edge — the barline closing this bar. */
  readonly x1: number;
  readonly timeSignature: { readonly numerator: number; readonly denominator: number } | null;
  /** Key fifths drawn at this bar's start (only when displayed). */
  readonly keyFifths: number | null;
  /** Key fifths in effect for this bar (accidental logic). */
  readonly fifths: number;
  readonly tracks: readonly TrackBar[];
  /** True when this bar opens its system (clef/key/time are drawn). */
  readonly systemStart: boolean;
}

export interface SystemBox {
  readonly index: number;
  /** Top y of the whole system block (absolute). */
  readonly y: number;
  readonly height: number;
  readonly bars: readonly BarBox[];
}

export interface LayoutDocument {
  readonly score: Score;
  readonly width: number;
  readonly staffSpace: number;
  readonly tabLineGap: number;
  readonly systems: readonly SystemBox[];
  readonly height: number;
  readonly hasHeader: boolean;
  /** (absTick → x) knots along the playhead track, in layout order. */
  readonly playheadKnots: readonly PlayheadKnot[];
}

/** One interpolation point of the playhead's x over absolute tick time. */
export interface PlayheadKnot {
  readonly absTick: number;
  readonly x: number;
  readonly top: number;
  readonly bottom: number;
}

/**
 * Builds the playhead knot table: one knot per beat column, plus a trailing
 * knot at each system's final barline (so line wraps step to the next
 * system exactly at the boundary tick). Within a system the segment from a
 * bar's last beat to the next bar's first beat is unbroken — the playhead
 * crosses shared barlines without freezing or teleporting.
 */
function buildPlayheadTrack(score: Score, systems: readonly SystemBox[], tabGap: number): PlayheadKnot[] {
  const knots: PlayheadKnot[] = [];
  for (const system of systems) {
    const tb = system.bars[0]?.tracks[0];
    if (!tb) continue;
    const top = tb.notation ? tb.staffTop - 8 : tb.tabTop - 8;
    const bottom = tb.tab && tb.stringCount > 0
      ? tb.tabTop + (tb.stringCount - 1) * tabGap + 8
      : tb.staffTop + STAFF_SPACE * 4 + 8;
    for (const bar of system.bars) {
      const barAbs = absoluteTickOfBar(score, bar.index);
      for (const beat of bar.tracks[0]?.beats ?? []) {
        knots.push({ absTick: barAbs + beat.start, x: beat.x, top, bottom });
      }
      const cap = ticksPerBar(bar.bar.timeSignature);
      const isLastOfSystem = system.bars[system.bars.length - 1]?.index === bar.index;
      if (isLastOfSystem) {
        knots.push({ absTick: barAbs + cap, x: bar.x1 - 2, top, bottom });
      }
    }
  }
  return knots;
}

/** Click on the score resolved into core-model coordinates. */
export interface ClickedPosition {
  readonly barIndex: number;
  readonly tick: number;
  readonly stringIndex: number | null;
}

interface BeatSeed {
  readonly start: number;
  readonly duration: number;
  readonly notes: Note[];
  readonly isRest: boolean;
}

/** Groups notes into rhythmic columns, inserting rests to fill the bar. */
export function groupIntoBeats(notes: readonly Note[], bar: Bar): BeatSeed[] {
  const byStart = new Map<number, Note[]>();
  for (const note of notes) {
    const list = byStart.get(note.start);
    if (list) list.push(note);
    else byStart.set(note.start, [note]);
  }
  const capacity = ticksPerBar(bar.timeSignature);
  const seeds: BeatSeed[] = [];
  let cursor = 0;
  for (const start of [...byStart.keys()].sort((a, b) => a - b)) {
    const group = byStart.get(start);
    if (!group || start >= capacity) break;
    if (start > cursor) {
      seeds.push({ start: cursor, duration: start - cursor, notes: [], isRest: true });
    }
    const duration = Math.min(...group.map((n) => n.duration));
    seeds.push({
      start,
      duration,
      notes: [...group].sort((a, b) => (a.string ?? 0) - (b.string ?? 0)),
      isRest: false,
    });
    cursor = Math.max(cursor, start + duration);
  }
  if (cursor < capacity) {
    seeds.push({ start: cursor, duration: capacity - cursor, notes: [], isRest: true });
  }
  return seeds;
}

/** Beat column width — proportional spacing (sqrt of duration). */
export function beatWidth(duration: number, staffSpace: number): number {
  const quarters = duration / TICKS_PER_QUARTER;
  const base = Math.sqrt(Math.max(quarters, 1 / 16)) * staffSpace * 2.05;
  return Math.max(staffSpace * 1.4, base);
}

const SHARP_ORDER: readonly number[] = [5, 0, 7, 2, 4, 9, 11]; // F C G D A E B
const FLAT_ORDER: readonly number[] = [11, 9, 7, 2, 0, 5, 10]; // B E A D G C F

/** PCs altered by a key signature of `fifths` (positive = sharps). */
export function keyAlteredPcs(fifths: number): Set<number> {
  const pcs = new Set<number>();
  const order = fifths >= 0 ? SHARP_ORDER : FLAT_ORDER;
  for (let i = 0; i < Math.min(Math.abs(fifths), 7); i++) {
    const pc = order[i];
    if (pc !== undefined) pcs.add(pc);
  }
  return pcs;
}

const SEMI_TO_STEP: readonly number[] = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];

function diatonicStep(midi: number): number {
  const pc = ((midi % 12) + 12) % 12;
  return Math.floor(midi / 12) * 7 + (SEMI_TO_STEP[pc] ?? 0);
}

/** Diatonic index of written B4 — the middle line of the treble staff. */
export const B4_STEP = 41;

/**
 * Notation staff position of a sounding pitch: half-steps above the middle
 * line of the staff (positive = higher). Guitar is written one octave above
 * the sounding pitch; bass uses the bass clef (middle line = D3).
 */
export function staffPositionForPitch(midi: number, clef: "g2" | "f4" | "tabs" | "percussion" | "c3" | "c4"): number {
  if (clef === "f4") return diatonicStep(midi) - diatonicStep(50); // D3 = bass middle line
  if (clef === "tabs" || clef === "percussion") return 0;
  const written = midi + 12; // guitar transposition
  return diatonicStep(written) - B4_STEP;
}

/** True when the sounding pitch's pc needs an accidental (black-key pc). */
export function pitchIsAltered(midi: number): boolean {
  const pc = ((midi % 12) + 12) % 12;
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
}

export type DurationClass = "whole" | "half" | "quarter" | "eighth" | "16th" | "32nd";

export function durationClass(ticks: number): DurationClass {
  const quarters = ticks / TICKS_PER_QUARTER;
  if (quarters >= 4) return "whole";
  if (quarters >= 2) return "half";
  if (quarters >= 1) return "quarter";
  if (quarters >= 0.5) return "eighth";
  if (quarters >= 0.25) return "16th";
  return "32nd";
}

/** Absolute tick position of the start of bar `barIndex`. */
export function absoluteTickOfBar(score: Score, barIndex: number): number {
  let acc = 0;
  for (let i = 0; i < barIndex; i++) {
    const bar = score.bars[i];
    if (bar) acc += ticksPerBar(bar.timeSignature);
  }
  return acc;
}

interface TrackLayout {
  readonly track: Track;
  readonly trackIndex: number;
  readonly notation: boolean;
  readonly tab: boolean;
  readonly stringCount: number;
  readonly blockHeight: number;
  /** Space above the top staff line needed by out-of-staff notes (px). */
  readonly overUp: number;
  /** Space below the bottom staff line needed by deep notes (px). */
  readonly overDown: number;
  /** Offsets of the staves within the track block (px from block top). */
  readonly staffTopOffset: number;
  readonly tabTopOffset: number;
}

function trackLayouts(score: Score, tabGap: number): TrackLayout[] {
  return score.tracks.map((track, trackIndex) => {
    const strings = track.tuning?.strings.length ?? 0;
    const fretted = strings > 0 && (track.instrument === "guitar" || track.instrument === "bass");
    const notation = track.clef === "g2" || track.clef === "f4" || fretted;
    const tab = strings > 0;

    // Notation extremes: high frets push notes far above the staff (ledger
    // lines), deep notes far below — reserve that space so systems never
    // collide with the header or the neighboring system.
    let maxPos = 0;
    let minPos = 0;
    if (notation) {
      maxPos = -Number.MAX_SAFE_INTEGER;
      minPos = Number.MAX_SAFE_INTEGER;
      for (const bar of score.bars) {
        for (const note of bar.voices[0]?.notes ?? []) {
          const pos = staffPositionForPitch(note.pitch, track.clef);
          if (pos > maxPos) maxPos = pos;
          if (pos < minPos) minPos = pos;
        }
      }
    }
    const overUp = notation && maxPos > 4 ? (maxPos - 4) * (STAFF_SPACE / 2) : 0;
    const overDown = notation && minPos < -4 ? (-4 - minPos) * (STAFF_SPACE / 2) : 0;
    const staffTopOffset = overUp;
    const tabTopOffset = overUp + STAFF_SPACE * 4 + overDown + STAFF_SPACE * 2.1;

    let blockHeight = 0;
    if (notation) blockHeight += staffTopOffset + STAFF_SPACE * 4 + overDown + STAFF_SPACE * 2.1;
    if (tab) blockHeight += Math.max(strings - 1, 0) * tabGap + STAFF_SPACE * 2.7;
    return {
      track,
      trackIndex,
      notation,
      tab,
      stringCount: strings,
      blockHeight,
      overUp,
      overDown,
      staffTopOffset,
      tabTopOffset,
    };
  });
}

/** Width reserved left of the first bar's content (clef + key + time columns). */
function systemLeadWidth(
  _hasNotation: boolean,
  _hasTab: boolean,
  fifths: number,
  showTime: boolean,
  staffSpace: number,
): number {
  // clef column ~4.6 spaces (Bravura gClef8vb is wide) + key accidentals
  // + time block ~2.6 spaces + margin before the first beat
  let lead = staffSpace * 8.6;
  lead += Math.abs(fifths) * staffSpace * 0.95;
  if (!showTime) lead -= staffSpace * 2.6;
  return lead;
}

/** Effective time signature per bar (carries forward). */
function effectiveTimeSig(score: Score, barIndex: number): Bar["timeSignature"] | null {
  let sig: Bar["timeSignature"] | null = null;
  for (let i = 0; i <= barIndex; i++) {
    const bar = score.bars[i];
    if (bar?.timeSignature) sig = bar.timeSignature;
  }
  return sig;
}

/**
 * Eighth-note beam group size per meter (standard engraving practice,
 * cf. Gould "Behind Bars"): 4/4 → 4 (half-bar), 3/4 → 3, 2/4 → 2,
 * compound meters (6/8, 9/8, 12/8) → 3 per dotted-quarter beat.
 */
export function beamGroupSize(ts: { readonly numerator: number; readonly denominator: number }): number {
  if (ts.denominator === 8 && ts.numerator % 3 === 0) return 3;
  if (ts.denominator === 4) return Math.min(Math.max(ts.numerator, 2), 4);
  return 4;
}

/**
 * Assigns beam-group ids to runs of equal, short, non-rest beats that start
 * within the same metrical group slot (per the time signature's beam group
 * size). Rests and longer values break the run.
 */
function assignBeamGroups(seeds: readonly BeatSeed[], groupTicks: number): number[] {
  const ids = seeds.map(() => -1);
  const EIGHTH = TICKS_PER_QUARTER / 2;
  const slotOf = (start: number): number => Math.floor(start / Math.max(groupTicks, 1));
  let nextId = 0;
  let i = 0;
  while (i < seeds.length) {
    const seed = seeds[i];
    if (!seed || seed.isRest || seed.duration > EIGHTH) {
      i++;
      continue;
    }
    const slot = slotOf(seed.start);
    let j = i;
    while (
      j < seeds.length &&
      !seeds[j]?.isRest &&
      seeds[j]?.duration === seed.duration &&
      slotOf(seeds[j]?.start ?? -1) === slot
    ) {
      j++;
    }
    if (j - i >= 2) {
      for (let k = i; k < j; k++) {
        const target = ids[k];
        if (target !== undefined) ids[k] = nextId;
      }
      nextId++;
    }
    i = Math.max(j, i + 1);
  }
  return ids;
}

/**
 * Computes the full layout. Bars wrap greedily into systems whose content is
 * stretched to fill the available width; per-track staves stack vertically.
 */
export function computeLayout(score: Score, params: LayoutParams): LayoutDocument {
  const staffSpace = STAFF_SPACE;
  const tabGap = TAB_LINE_GAP;
  const padding = params.padding ?? staffSpace * 3.4;
  const contentWidth = Math.max(params.width - padding * 2, staffSpace * 16);
  const HEADER_HEIGHT = 104;
  const minBarWidth = staffSpace * 4.6;

  const tracks = trackLayouts(score, tabGap);
  const hasNotation = tracks.some((t) => t.notation);
  const hasTab = tracks.some((t) => t.tab);

  // Effective key signature per bar (carries forward).
  const fifthsPerBar: number[] = [];
  score.bars.forEach((bar, i) => {
    fifthsPerBar.push(bar.keyChange?.fifths ?? fifthsPerBar[i - 1] ?? 0);
  });

  // Beat seeds per (bar, track) with proportional widths.
  const seedsPerBar = score.bars.map((bar) =>
    tracks.map(() => {
      const notes = bar.voices[0]?.notes ?? [];
      const seeds = groupIntoBeats(notes, bar);
      return seeds.map((seed) => ({ seed, width: beatWidth(seed.duration, staffSpace) }));
    }),
  );

  // Base content width per bar (max across tracks).
  const baseWidths = score.bars.map((_bar, bi) => {
    let w = staffSpace * 1.6;
    for (const trackSeeds of seedsPerBar[bi] ?? []) {
      let tw = 0;
      for (const s of trackSeeds) tw += s.width;
      w = Math.max(w, tw);
    }
    return w;
  });

  // Time signature shown at bar 0 and on changes.
  const showTimeAt = (i: number): boolean => {
    const bar = score.bars[i];
    if (!bar) return false;
    if (i === 0) return true;
    const prev = score.bars[i - 1];
    return prev !== undefined &&
      (prev.timeSignature.numerator !== bar.timeSignature.numerator ||
        prev.timeSignature.denominator !== bar.timeSignature.denominator);
  };

  // --- Pass 1: wrap bars into systems (greedy; measures are contiguous). ---
  const groups: number[][] = [];
  {
    let group: number[] = [];
    let acc = 0;
    for (let i = 0; i < score.bars.length; i++) {
      const lead = group.length === 0
        ? systemLeadWidth(hasNotation, hasTab, fifthsPerBar[i] ?? 0, showTimeAt(i), staffSpace)
        : 0;
      const need = Math.max(baseWidths[i] ?? 0, minBarWidth) + lead;
      if (group.length > 0 && acc + need > contentWidth) {
        groups.push(group);
        group = [];
        acc = 0;
      }
      group.push(i);
      acc += Math.max(baseWidths[i] ?? 0, minBarWidth);
    }
    if (group.length > 0) groups.push(group);
  }

  // --- Pass 2: geometry per system. ---
  const systems: SystemBox[] = [];
  let yCursor = staffSpace * 1.2;
  for (let s = 0; s < groups.length; s++) {
    const barIndexes = groups[s] ?? [];
    const isFirst = s === 0;
    const headerBlock = isFirst ? HEADER_HEIGHT : 0;
    const topGap = isFirst ? 0 : staffSpace * 1.7;
    const contentTop = yCursor + headerBlock + topGap;

    // Track staves stack from contentTop — one geometry entry per track.
    // Offsets account for ledger-line overhang of out-of-staff notes.
    const geoms: { staffTop: number; tabTop: number; strings: number }[] = [];
    let cursorY = contentTop;
    for (const t of tracks) {
      const staffTop = t.notation ? cursorY + t.staffTopOffset : 0;
      const tabTop = t.tab ? cursorY + t.tabTopOffset : 0;
      geoms.push({ staffTop, tabTop, strings: t.stringCount });
      cursorY += t.blockHeight;
    }
    const blockHeight = cursorY - contentTop;
    const systemHeight = headerBlock + topGap + blockHeight + staffSpace * 1.5;

    // Stretch bar contents to fill the system width (measures share barlines).
    const firstBarIndex = barIndexes[0] ?? 0;
    const lead = systemLeadWidth(
      hasNotation,
      hasTab,
      fifthsPerBar[firstBarIndex] ?? 0,
      showTimeAt(firstBarIndex),
      staffSpace,
    );
    const widths = barIndexes.map((bi) => Math.max(baseWidths[bi] ?? 0, minBarWidth));
    const totalContent = widths.reduce((a, b) => a + b, 0);
    // the last system leaves room after the final barline for the +/− controls
    const tailReserve = s === groups.length - 1 ? staffSpace * 6.6 : 0;
    const available = contentWidth - lead - tailReserve;
    const scale = totalContent > 0 ? Math.max(available / totalContent, 0.55) : 1;
    const stretched = widths.map((w) => w * scale);

    let xCursor = padding;
    const bars: BarBox[] = [];
    for (let k = 0; k < barIndexes.length; k++) {
      const bi = barIndexes[k];
      if (bi === undefined) continue;
      const bar = score.bars[bi];
      if (!bar) continue;
      const x0 = xCursor;
      const barLead = k === 0 ? lead : 0;
      const contentX = x0 + barLead;
      const innerW = stretched[k] ?? 0;
      const x1 = contentX + innerW;

      const groupTicks = beamGroupSize(bar.timeSignature) * (TICKS_PER_QUARTER / 2);
      const trackBars: TrackBar[] = tracks.map((info, t) => {
        const geom = geoms[t];
        if (!geom) throw new Error("layout geometry missing for track");
        const entries = seedsPerBar[bi]?.[t] ?? [];
        const rawW = entries.reduce((a, e) => a + e.width, 0);
        const ts = rawW > 0 ? innerW / rawW : 1;
        let bx = contentX;
        const beams = assignBeamGroups(entries.map((e) => e.seed), groupTicks);
        const beats: Beat[] = entries.map((entry, idx) => {
          const w = entry.width * ts;
          const beat: Beat = {
            start: entry.seed.start,
            duration: entry.seed.duration,
            notes: entry.seed.notes,
            isRest: entry.seed.isRest,
            x: bx + w / 2,
            width: w,
            beamId: beams[idx] ?? -1,
          };
          bx += w;
          return beat;
        });
        return {
          trackIndex: t,
          track: info.track,
          beats,
          notation: info.notation,
          tab: info.tab,
          staffTop: geom.staffTop,
          tabTop: geom.tabTop,
          stringCount: geom.strings,
        };
      });

      bars.push({
        index: bi,
        bar,
        x0,
        x1,
        timeSignature: k === 0 ? (effectiveTimeSig(score, bi) ?? bar.timeSignature) : null,
        keyFifths: k === 0 ? (fifthsPerBar[bi] ?? 0) : null,
        fifths: fifthsPerBar[bi] ?? 0,
        tracks: trackBars,
        systemStart: k === 0,
      });
      xCursor = x1; // measures are contiguous — the barline is shared
    }

    systems.push({ index: s, y: yCursor, height: systemHeight, bars });
    yCursor += systemHeight;
  }

  return {
    score,
    width: params.width,
    staffSpace,
    tabLineGap: tabGap,
    systems,
    height: Math.max(yCursor + staffSpace * 1.2, staffSpace * 14),
    hasHeader: groups.length > 0,
    playheadKnots: buildPlayheadTrack(score, systems, tabGap),
  };
}

// ---------------------------------------------------------------------------
// Hit-testing & anchors
// ---------------------------------------------------------------------------

export interface Anchor {
  readonly x: number;
  readonly y: number;
  /** Top y of the caret/playhead line. */
  readonly top: number;
  /** Bottom y of the caret/playhead line. */
  readonly bottom: number;
}

function findBarBox(layout: LayoutDocument, barIndex: number): { system: SystemBox; bar: BarBox } | null {
  for (const system of layout.systems) {
    for (const bar of system.bars) {
      if (bar.index === barIndex) return { system, bar };
    }
  }
  return null;
}

/** x within a bar at `tick` — piecewise-linear between beat centers. */
function xAtTick(bar: BarBox, tick: number): number {
  const beats = bar.tracks[0]?.beats ?? [];
  if (beats.length === 0) return bar.x0 + (bar.x1 - bar.x0) * 0.35;
  const first = beats[0];
  const last = beats[beats.length - 1];
  if (first && tick <= first.start) {
    return first.x; // exactly on the first note/rest column
  }
  if (last && tick >= last.start) {
    return Math.min(bar.x1 - 4, last.x);
  }
  for (let i = 0; i < beats.length - 1; i++) {
    const a = beats[i];
    const b = beats[i + 1];
    if (a && b && tick >= a.start && tick <= b.start) {
      if (tick === a.start) return a.x;
      if (tick === b.start) return b.x;
      const span = b.start - a.start;
      const t = span > 0 ? (tick - a.start) / span : 0;
      return a.x + (b.x - a.x) * t;
    }
  }
  return last ? last.x : bar.x0;
}

/** Resolves an SVG-space point to the nearest score position. */
export function positionAt(layout: LayoutDocument, x: number, y: number): ClickedPosition | null {
  if (layout.systems.length === 0) return null;
  const system =
    layout.systems.find((s) => y >= s.y && y <= s.y + s.height) ??
    nearestBy(layout.systems, (s) => s.y + s.height / 2, y);
  if (!system) return null;

  const bar =
    system.bars.find((b) => x >= b.x0 && x <= b.x1) ??
    nearestBy(system.bars, (b) => b.x0 + (b.x1 - b.x0) / 2, x);
  if (!bar) return null;

  const trackBar = bar.tracks[0];
  const capacity = ticksPerBar(bar.bar.timeSignature);

  let tick = 0;
  const beats = trackBar?.beats ?? [];
  if (beats.length > 0 && beats[0]) {
    let nearest = beats[0];
    for (const b of beats) {
      if (Math.abs(b.x - x) < Math.abs(nearest.x - x)) nearest = b;
    }
    tick = Math.min(Math.max(0, nearest.start), Math.max(0, capacity - TICKS_PER_QUARTER / 8));
  }

  let stringIndex: number | null = null;
  if (trackBar && trackBar.tab && trackBar.stringCount > 0) {
    const gap = layout.tabLineGap;
    const tabBottom = trackBar.tabTop + (trackBar.stringCount - 1) * gap;
    if (y >= trackBar.tabTop - gap * 0.8 && y <= tabBottom + gap * 0.8) {
      stringIndex = Math.min(
        trackBar.stringCount - 1,
        Math.max(0, Math.round((y - trackBar.tabTop) / gap)),
      );
    }
  }

  return { barIndex: bar.index, tick, stringIndex };
}

/** Caret anchor for a (bar, tick, string) position in tab space. */
export function caretAnchor(
  layout: LayoutDocument,
  barIndex: number,
  tick: number,
  stringIndex: number,
): Anchor | null {
  const found = findBarBox(layout, barIndex);
  if (!found) return null;
  const { bar } = found;
  const tb = bar.tracks[0];
  if (!tb) return null;
  const gap = layout.tabLineGap;
  if (tb.tab && tb.stringCount > 0) {
    const clamped = Math.min(tb.stringCount - 1, Math.max(0, stringIndex));
    const y = tb.tabTop + clamped * gap;
    return { x: xAtTick(bar, tick), y, top: tb.tabTop - gap * 0.6, bottom: tb.tabTop + (tb.stringCount - 1) * gap + gap * 0.6 };
  }
  const middleY = tb.staffTop + layout.staffSpace * 2;
  return { x: xAtTick(bar, tick), y: middleY, top: tb.staffTop - 6, bottom: tb.staffTop + layout.staffSpace * 4 + 6 };
}

/** Playhead anchor for an absolute tick — piecewise-linear along a knot table
 * built from the beat columns, so the playhead glides continuously THROUGH
 * barlines (and steps cleanly to the next system when lines wrap). */
export function playheadAnchorAt(
  layout: LayoutDocument,
  absTick: number,
): { x: number; top: number; bottom: number } | null {
  const knots = layout.playheadKnots;
  if (knots.length === 0) return null;
  const first = knots[0];
  const last = knots[knots.length - 1];
  if (!first || !last) return null;
  if (absTick <= first.absTick) return { x: first.x, top: first.top, bottom: first.bottom };
  if (absTick >= last.absTick) return { x: last.x, top: last.top, bottom: last.bottom };
  let lo = 0;
  let hi = knots.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const k = knots[mid];
    if (k && k.absTick <= absTick) lo = mid;
    else hi = mid - 1;
  }
  const a = knots[lo];
  const b = knots[lo + 1];
  if (!a || !b) return { x: a?.x ?? first.x, top: a?.top ?? 0, bottom: a?.bottom ?? 0 };
  if (b.absTick <= a.absTick) {
    // system wrap: step to the next line's first beat
    return { x: b.x, top: b.top, bottom: b.bottom };
  }
  const t = (absTick - a.absTick) / (b.absTick - a.absTick);
  return { x: a.x + (b.x - a.x) * t, top: a.top, bottom: a.bottom };
}

/** Visual bounds of a bar (all staves of its system block). */
export function barRectAt(layout: LayoutDocument, barIndex: number): Rect | null {
  const found = findBarBox(layout, barIndex);
  if (!found) return null;
  const { system, bar } = found;
  return { x: bar.x0, y: system.y, w: bar.x1 - bar.x0, h: system.height };
}

function nearestBy<T>(items: readonly T[], centerOf: (item: T) => number, value: number): T | null {
  let best: T | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const dist = Math.abs(centerOf(item) - value);
    if (dist < bestDist) {
      best = item;
      bestDist = dist;
    }
  }
  return best;
}
