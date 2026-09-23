import type { Note } from "@stdbd/core";
import type { BarBox, LayoutDocument, TrackBar } from "./layout.js";
import { durationClass, keyAlteredPcs, type DurationClass } from "./layout.js";
import { G, MUSIC_FONT } from "./smufl.js";
import { engravingTheme } from "./theme.js";

/**
 * SVG engraver: renders a LayoutDocument into inline SVG markup.
 *
 * Visual language: Bravura (SMuFL) glyphs, aligned notation + tablature
 * staves, proportional beat spacing, beamed short-note runs, dark theme.
 */

const TWO = (n: number): string => String(Math.round(n * 100) / 100);

const UI_TEXT_FONT = "Inter Variable, Inter, 'Segoe UI', sans-serif";
const UI_MONO_FONT = "JetBrains Mono Variable, 'JetBrains Mono', Consolas, monospace";

/** Vertical gap between tab string lines (px) â€” matches layout.TAB_LINE_GAP. */
const TAB_LINE_GAP = 9;

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const SEMI_TO_STEP: readonly number[] = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
/** Diatonic index of written B4 â€” the middle line of the treble staff. */
const B4_STEP = 41;

function diatonicStep(midi: number): number {
  const pc = ((midi % 12) + 12) % 12;
  return Math.floor(midi / 12) * 7 + (SEMI_TO_STEP[pc] ?? 0);
}

/** Half-steps above the middle staff line (positive = higher); guitar written +12. */
function staffPos(midi: number, isGuitar: boolean): number {
  const written = isGuitar ? midi + 12 : midi;
  return diatonicStep(written) - B4_STEP;
}

/** Written MIDI notes of key-signature accidentals, in order (treble octave). */
const KEY_SIG_SHARP: readonly number[] = [77, 72, 79, 74, 69, 76, 71]; // F#5 C#5 G#5 D#5 A#4 E#5 B#4
const KEY_SIG_FLAT: readonly number[] = [70, 75, 68, 74, 66, 71, 64]; // Bb4 Eb5 Ab4 Db5 Gb4 Cb5 Fb4

const STEM_ATTACH = 0.58;
const STEM_LEN = 3.4;
const STEM_W = 0.13;
const BEAM_THICKNESS = 0.5;
const BEAM_GAP = 0.95;

function flagCodepoint(dc: DurationClass, up: boolean): number {
  if (dc === "32nd") return up ? G.flag32ndUp : G.flag32ndDown;
  if (dc === "16th") return up ? G.flag16thUp : G.flag16thDown;
  return up ? G.flag8thUp : G.flag8thDown;
}

function beamLevels(dc: DurationClass): number {
  if (dc === "16th") return 2;
  if (dc === "32nd") return 3;
  if (dc === "eighth") return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// SVG primitives
// ---------------------------------------------------------------------------

interface GlyphOpts {
  readonly size: number;
  readonly anchor?: "start" | "middle" | "end";
  readonly fill?: string;
  readonly cls?: string;
}

function glyph(codepoint: number, x: number, y: number, opts: GlyphOpts): string {
  return (
    `<text${opts.cls ? ` class="${opts.cls}"` : ""} font-family="${MUSIC_FONT}" font-size="${TWO(opts.size)}"` +
    ` fill="${opts.fill ?? engravingTheme.fontColor}" text-anchor="${opts.anchor ?? "middle"}"` +
    ` x="${TWO(x)}" y="${TWO(y)}">&#x${codepoint.toString(16)};</text>`
  );
}

function line(x1: number, y1: number, x2: number, y2: number, stroke: string, width: number, cls = ""): string {
  return (
    `<line${cls ? ` class="${cls}"` : ""} x1="${TWO(x1)}" y1="${TWO(y1)}" x2="${TWO(x2)}" y2="${TWO(y2)}"` +
    ` stroke="${stroke}" stroke-width="${TWO(width)}" stroke-linecap="butt" />`
  );
}

function rect(x: number, y: number, w: number, h: number, fill: string, rx = 0, cls = ""): string {
  return (
    `<rect${cls ? ` class="${cls}"` : ""} x="${TWO(x)}" y="${TWO(y)}"` +
    ` width="${TWO(Math.max(w, 0))}" height="${TWO(Math.max(h, 0))}" fill="${fill}" rx="${rx}" />`
  );
}

function uiText(
  x: number,
  y: number,
  content: string,
  opts: { size: number; fill: string; weight?: number; anchor?: "start" | "middle" | "end"; cls?: string; mono?: boolean },
): string {
  const family = opts.mono ? UI_MONO_FONT : UI_TEXT_FONT;
  const weight = opts.weight ? ` font-weight="${opts.weight}"` : "";
  return (
    `<text${opts.cls ? ` class="${opts.cls}"` : ""} x="${TWO(x)}" y="${TWO(y)}" font-family="${family}"` +
    ` font-size="${TWO(opts.size)}"${weight} fill="${opts.fill}" text-anchor="${opts.anchor ?? "start"}">` +
    escapeXml(content) +
    `</text>`
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Engraves the layout into a complete standalone <svg> markup string. */
export function engrave(layout: LayoutDocument): string {
  const S = layout.staffSpace;
  const parts: string[] = [
    `<svg class="stdb-score" xmlns="http://www.w3.org/2000/svg" width="${TWO(layout.width)}" height="${TWO(layout.height)}" viewBox="0 0 ${TWO(layout.width)} ${TWO(layout.height)}" aria-hidden="true">`,
    `<defs><filter id="stdb-glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="2.6"/></filter></defs>`,
  ];
  if (layout.hasHeader) drawHeader(layout, S, parts);
  for (const system of layout.systems) {
    const lastSystem = system.index === layout.systems.length - 1;
    for (const bar of system.bars) {
      const isFinal = lastSystem && bar.index === system.bars[system.bars.length - 1]?.index;
      for (const tb of bar.tracks) drawTrackBar(bar, tb, S, isFinal, parts);
    }
  }
  parts.push("</svg>");
  return parts.join("");
}

// ---------------------------------------------------------------------------
// Header (title / artist / tempo)
// ---------------------------------------------------------------------------

function drawHeader(layout: LayoutDocument, S: number, parts: string[]): void {
  const cx = layout.width / 2;
  if (layout.score.title) {
    parts.push(
      uiText(cx, 42, layout.score.title, { size: 27, weight: 660, fill: engravingTheme.fontColor, anchor: "middle", cls: "stdb-title" }),
    );
  }
  if (layout.score.artist) {
    parts.push(
      uiText(cx, 66, layout.score.artist, { size: 14, weight: 480, fill: engravingTheme.secondaryColor, anchor: "middle", cls: "stdb-artist" }),
    );
  }
  const tempo = layout.score.bars.find((b) => b.tempo !== null)?.tempo;
  if (tempo !== undefined) {
    const x = S * 3.2;
    parts.push(glyph(G.noteQuarterUp, x, 92, { size: S * 2.6, anchor: "middle", fill: engravingTheme.secondaryColor }));
    parts.push(
      uiText(x + S * 1.7, 92, `= ${tempo}`, { size: 15, weight: 520, fill: engravingTheme.secondaryColor, cls: "stdb-tempo", mono: true }),
    );
  }
}

// ---------------------------------------------------------------------------
// System / bar / track scaffolding
// ---------------------------------------------------------------------------

function drawTrackBar(bar: BarBox, tb: TrackBar, S: number, isFinal: boolean, parts: string[]): void {
  const tabBottom = tb.tabTop + Math.max(tb.stringCount - 1, 0) * TAB_LINE_GAP;
  const top = tb.notation ? tb.staffTop : tb.tabTop;
  const bottom = tb.tab && tb.stringCount > 0 ? tabBottom : tb.staffTop + S * 4;

  if (tb.notation) {
    for (let i = 0; i < 5; i++) {
      parts.push(line(bar.x0, tb.staffTop + i * S, bar.x1, tb.staffTop + i * S, engravingTheme.staffColor, 0.9));
    }
  }
  if (tb.tab && tb.stringCount > 0) {
    for (let i = 0; i < tb.stringCount; i++) {
      parts.push(line(bar.x0, tb.tabTop + i * TAB_LINE_GAP, bar.x1, tb.tabTop + i * TAB_LINE_GAP, engravingTheme.staffColor, 0.7));
    }
  }

  if (bar.systemStart) drawSystemHeader(bar, tb, S, parts);
  drawBarNumber(bar, tb, S, parts);
  drawNotation(bar, tb, S, parts);
  drawTabNumbers(bar, tb, parts);

  if (isFinal) {
    parts.push(line(bar.x1 - 4, top, bar.x1 - 4, bottom, engravingTheme.barlineColor, 1));
    parts.push(rect(bar.x1 - 2.4, top, 2.6, bottom - top, engravingTheme.barlineColor));
  } else {
    parts.push(line(bar.x1, top, bar.x1, bottom, engravingTheme.barlineColor, 0.9));
  }
  if (bar.systemStart) {
    parts.push(line(bar.x0, top, bar.x0, bottom, engravingTheme.barlineColor, 0.9));
  }
}

function drawBarNumber(bar: BarBox, tb: TrackBar, S: number, parts: string[]): void {
  if (!bar.systemStart || bar.index === 0) return;
  const y = (tb.notation ? tb.staffTop : tb.tabTop) - S * 1.1;
  parts.push(
    uiText(bar.x0 + S * 0.2, y, String(bar.index + 1), { size: 12, weight: 520, fill: engravingTheme.secondaryColor, cls: "stdb-bar-number", mono: true }),
  );
}

// ---------------------------------------------------------------------------
// Clef / key signature / time signature
// ---------------------------------------------------------------------------

function drawSystemHeader(bar: BarBox, tb: TrackBar, S: number, parts: string[]): void {
  if (tb.notation) {
    const isBass = tb.track.clef === "f4";
    parts.push(
      glyph(isBass ? G.fClef : G.gClef8vb, bar.x0 + S * 0.3, isBass ? tb.staffTop + S : tb.staffTop + S * 3, {
        size: S * 4,
        anchor: "start",
        cls: "stdb-clef",
      }),
    );
  }
  if (bar.keyFifths !== null && bar.keyFifths !== 0 && tb.notation) {
    drawKeySignature(bar, tb, S, parts);
  }
  if (bar.timeSignature && tb.notation) drawTimeSignature(bar, tb, S, parts);
}

function drawKeySignature(bar: BarBox, tb: TrackBar, S: number, parts: string[]): void {
  const fifths = bar.keyFifths ?? 0;
  const isSharp = fifths > 0;
  const midis = isSharp ? KEY_SIG_SHARP : KEY_SIG_FLAT;
  const count = Math.min(Math.abs(fifths), 7);
  const x0 = bar.x0 + S * 4.7;
  for (let i = 0; i < count; i++) {
    const midi = midis[i] ?? 71;
    const pos = staffPos(midi, true);
    const y = tb.staffTop + S * 2 - pos * (S / 2);
    parts.push(
      glyph(isSharp ? G.accidentalSharp : G.accidentalFlat, x0 + i * S * 0.95, y, {
        size: S * 2.7,
        anchor: "middle",
        cls: "stdb-key-accidental",
      }),
    );
  }
}

function drawTimeSignature(bar: BarBox, tb: TrackBar, S: number, parts: string[]): void {
  const ts = bar.timeSignature;
  if (!ts) return;
  // Bravura time-sig digits are centered on their baseline and span exactly
  // one staff space above and below it; one digit ≈ 1.9 spaces wide.
  const digitW = S * 2.0;
  const num = String(ts.numerator);
  const den = String(ts.denominator);
  const block = Math.max(num.length, den.length) * digitW;
  const x = bar.x0 + S * 4.7 + Math.abs(bar.keyFifths ?? 0) * S * 0.95 + S * 0.7;
  const numX = x + (block - num.length * digitW) / 2;
  const denX = x + (block - den.length * digitW) / 2;
  for (let i = 0; i < num.length; i++) {
    const d = Number(num[i] ?? 0);
    parts.push(glyph(G.timeSig0 + d, numX + i * digitW, tb.staffTop + S, { size: S * 4, anchor: "middle", cls: "stdb-time-sig" }));
  }
  for (let i = 0; i < den.length; i++) {
    const d = Number(den[i] ?? 0);
    parts.push(glyph(G.timeSig0 + d, denX + i * digitW, tb.staffTop + S * 3, { size: S * 4, anchor: "middle", cls: "stdb-time-sig" }));
  }
}

// ---------------------------------------------------------------------------
// Notation beats â€” rests, chords, stems, beams, flags
// ---------------------------------------------------------------------------

function drawNotation(bar: BarBox, tb: TrackBar, S: number, parts: string[]): void {
  const middleY = tb.staffTop + S * 2;
  const accidentalState = new Map<number, AccidentalKind | null>();

  const beamGroups = new Map<number, number[]>();
  tb.beats.forEach((beat, idx) => {
    if (beat.beamId >= 0) {
      const arr = beamGroups.get(beat.beamId) ?? [];
      arr.push(idx);
      beamGroups.set(beat.beamId, arr);
    }
  });

  tb.beats.forEach((beat) => {
    if (beat.isRest) {
      drawRestGlyph(beat, S, middleY, parts);
      return;
    }
    const group = beamGroups.get(beat.beamId) ?? null;
    const beamed = group !== null && group.length >= 2;
    drawChord(beat, S, middleY, parts, beamed, bar.fifths, accidentalState);
  });

  for (const group of beamGroups.values()) {
    if (group.length >= 2) drawBeam(group, tb.beats, S, middleY, parts);
  }
}

function drawRestGlyph(
  beat: { readonly x: number; readonly duration: number },
  S: number,
  middleY: number,
  parts: string[],
): void {
  const dc = durationClass(beat.duration);
  const cp =
    dc === "whole" ? G.restWhole :
    dc === "half" ? G.restHalf :
    dc === "eighth" ? G.rest8th :
    dc === "16th" ? G.rest16th :
    dc === "32nd" ? G.rest32nd : G.restQuarter;
  const y = dc === "whole" ? middleY - S : middleY;
  parts.push(glyph(cp, beat.x, y, { size: S * 4, anchor: "middle", fill: engravingTheme.secondaryColor, cls: "stdb-rest" }));
}

type AccidentalKind = "sharp" | "flat" | "natural";

const ACCIDENTAL_CP: Record<AccidentalKind, number> = {
  sharp: G.accidentalSharp,
  flat: G.accidentalFlat,
  natural: G.accidentalNatural,
};

/** Default accidental a pc carries under the key signature (null = natural). */
function keyDefaultFor(pc: number, fifths: number): AccidentalKind | null {
  if (!keyAlteredPcs(fifths).has(pc)) return null;
  return fifths >= 0 ? "sharp" : "flat";
}

/** Accidental a note needs in this bar, or null when none is required. */
function accidentalFor(midi: number, fifths: number): AccidentalKind | null {
  const pc = ((midi % 12) + 12) % 12;
  const altered = pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
  if (altered) {
    if (keyAlteredPcs(fifths).has(pc)) return null; // already altered by the key
    if (fifths > 0) return "sharp";
    if (fifths < 0) return "flat";
    return pc === 1 || pc === 6 ? "sharp" : "flat";
  }
  return keyAlteredPcs(fifths).has(pc) ? "natural" : null;
}

/** Even staff positions of leger lines crossed by a note at `pos`. */
function legerPositions(pos: number): number[] {
  const lines: number[] = [];
  if (pos >= 6) {
    for (let lp = 6; lp <= pos; lp += 2) lines.push(lp);
  } else if (pos <= -6) {
    for (let lp = -6; lp >= pos; lp -= 2) lines.push(lp);
  }
  return lines;
}

/**
 * Horizontal notehead offsets: unisons and seconds (adjacent staff
 * positions) are offset to the stem side — standard engraving practice.
 */
function headDxs(positions: readonly number[], stemUp: boolean, S: number): number[] {
  const dxs = positions.map(() => 0);
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i] ?? 0;
    for (let j = 0; j < i; j++) {
      const prev = positions[j] ?? 0;
      if (Math.abs(pos - prev) <= 1 && dxs[j] === 0) {
        dxs[i] = stemUp ? S * 0.69 : -S * 0.69;
        break;
      }
    }
  }
  return dxs;
}

function drawChord(
  beat: { readonly x: number; readonly notes: readonly Note[]; readonly duration: number },
  S: number,
  middleY: number,
  parts: string[],
  beamed: boolean,
  fifths: number,
  accidentalState: Map<number, AccidentalKind | null>,
): void {
  const notes = beat.notes;
  if (notes.length === 0) return;
  const isGuitar = notes.some((n) => n.string !== null && n.fret !== null);
  const positions = notes.map((n) => staffPos(n.pitch, isGuitar));
  // the note farthest from the middle line decides the stem direction
  const maxPos = Math.max(...positions);
  const minPos = Math.min(...positions);
  const stemUp = -minPos >= maxPos;
  const dxs = headDxs(positions, stemUp, S);
  const dc = durationClass(beat.duration);
  const headCp = dc === "whole" ? G.noteheadWhole : dc === "half" ? G.noteheadHalf : G.noteheadBlack;
  const stemXs: number[] = [];
  const tipYs: number[] = [];
  notes.forEach((note, i) => {
    const pos = positions[i] ?? 0;
    const dx = dxs[i] ?? 0;
    const y = middleY - pos * (S / 2);
    // leger lines for notes beyond the staff
    for (const lp of legerPositions(pos)) {
      const ly = middleY - lp * (S / 2);
      parts.push(line(beat.x + dx - S * 1.05, ly, beat.x + dx + S * 1.05, ly, engravingTheme.staffColor, 1.1));
    }
    // accidental — measure-scoped memory keyed by staff position
    const desired = accidentalFor(note.pitch, fifths);
    const current = accidentalState.get(pos) ?? keyDefaultFor(((note.pitch % 12) + 12) % 12, fifths);
    if (desired !== null && desired !== current) {
      parts.push(
        glyph(ACCIDENTAL_CP[desired], beat.x + dx - S * 1.35, y, {
          size: S * 2.7,
          anchor: "middle",
          cls: "stdb-accidental",
        }),
      );
      accidentalState.set(pos, desired);
    }
    parts.push(glyph(headCp, beat.x + dx, y, { size: S * 4, anchor: "middle", cls: "stdb-notehead" }));
    if (beamed || dc === "whole") return; // stems/beams come from drawBeam
    const stemX = beat.x + dx + (stemUp ? S * STEM_ATTACH : -S * STEM_ATTACH);
    const tipY = stemUp ? y - STEM_LEN * S : y + STEM_LEN * S;
    parts.push(line(stemX, y, stemX, tipY, engravingTheme.beamColor, S * STEM_W));
    stemXs.push(stemX);
    tipYs.push(tipY);
  });
  if (dc !== "whole" && !beamed) {
    const lastStem = stemXs[stemXs.length - 1];
    const lastTip = tipYs[tipYs.length - 1];
    if (lastStem !== undefined && lastTip !== undefined) {
      parts.push(glyph(flagCodepoint(dc, stemUp), lastStem, lastTip, { size: S * 4, anchor: "start", cls: "stdb-flag" }));
    }
  }
}

function drawBeam(
  group: readonly number[],
  beats: readonly { readonly x: number; readonly notes: readonly Note[]; readonly duration: number }[],
  S: number,
  middleY: number,
  parts: string[],
): void {
  interface Stem {
    readonly x: number;
    readonly headY: number;
    readonly dc: DurationClass;
  }
  const collected: { beat: (typeof beats)[number]; positions: number[]; dc: DurationClass }[] = [];
  for (const idx of group) {
    const beat = beats[idx];
    if (!beat) continue;
    const notes = beat.notes;
    const isGuitar = notes.some((n) => n.string !== null && n.fret !== null);
    const positions = notes.map((n) => staffPos(n.pitch, isGuitar));
    collected.push({ beat, positions, dc: durationClass(beat.duration) });
  }
  if (collected.length < 2) return;
  // Gould's rule: the note farthest from the middle line determines the stem
  // direction of the whole beam group (ties go up).
  const allPositions = collected.flatMap((c) => c.positions);
  const maxPos = Math.max(...allPositions);
  const minPos = Math.min(...allPositions);
  const stemUp = -minPos >= maxPos;
  const attach = (stemUp ? S * STEM_ATTACH : -S * STEM_ATTACH);

  const stems: Stem[] = collected.map(({ beat, positions, dc }) => {
    const extreme = stemUp ? Math.min(...positions) : Math.max(...positions);
    const dxs = headDxs(positions, stemUp, S);
    const extremeIdx = positions.indexOf(extreme);
    const dx = extremeIdx >= 0 ? (dxs[extremeIdx] ?? 0) : 0;
    return { x: beat.x + dx + attach, headY: middleY - extreme * (S / 2), dc };
  });

  const first = stems[0];
  const last = stems[stems.length - 1];
  if (!first || !last) return;
  const firstTip = first.headY + (stemUp ? -STEM_LEN * S : STEM_LEN * S);
  const lastTip = last.headY + (stemUp ? -STEM_LEN * S : STEM_LEN * S);
  const span = Math.max(last.x - first.x, 1);
  const dyTotal = Math.max(-span * 0.3, Math.min(span * 0.3, lastTip - firstTip));
  const slope = dyTotal / span;
  const beamY = (x: number): number => firstTip + slope * (x - first.x);

  // stems reach exactly to the beam line at their x
  for (const stem of stems) {
    parts.push(line(stem.x, stem.headY, stem.x, beamY(stem.x), engravingTheme.beamColor, S * STEM_W));
  }

  const thickness = S * BEAM_THICKNESS;
  const gap = S * BEAM_GAP;
  const edge = stemUp ? thickness : -thickness;
  for (let k = 1; k < stems.length; k++) {
    const prev = stems[k - 1];
    const cur = stems[k];
    if (!prev || !cur) continue;
    const yA = beamY(prev.x);
    const yB = beamY(cur.x);
    parts.push(
      `<polygon fill="${engravingTheme.beamColor}" points="${TWO(prev.x)},${TWO(yA)} ${TWO(cur.x)},${TWO(yB)} ` +
        `${TWO(cur.x)},${TWO(yB + edge)} ${TWO(prev.x)},${TWO(yA + edge)}" />`,
    );
    const levels = Math.min(beamLevels(prev.dc), beamLevels(cur.dc));
    for (let level = 1; level < levels; level++) {
      const off = gap * level * (stemUp ? 1 : -1);
      parts.push(
        `<polygon fill="${engravingTheme.beamColor}" points="${TWO(prev.x)},${TWO(yA + off)} ${TWO(cur.x)},${TWO(yB + off)} ` +
          `${TWO(cur.x)},${TWO(yB + off + edge)} ${TWO(prev.x)},${TWO(yA + off + edge)}" />`,
      );
    }
  }
}

function drawTabNumbers(bar: BarBox, tb: TrackBar, parts: string[]): void {
  if (!tb.tab || tb.stringCount === 0) return;
  const n = tb.stringCount;
  if (bar.systemStart) {
    const labelY = tb.tabTop + ((n - 1) * TAB_LINE_GAP) / 2 + 5.2;
    parts.push(
      uiText(bar.x0 + 2, labelY, "TAB", {
        size: 17,
        weight: 620,
        fill: engravingTheme.secondaryColor,
        anchor: "start",
        cls: "stdb-tab-label",
        mono: true,
      }),
    );
  }
  for (const beat of tb.beats) {
    for (const note of beat.notes) {
      if (note.string === null || note.fret === null) continue;
      const y = tb.tabTop + note.string * TAB_LINE_GAP + 4.8;
      const ghost = note.articulations.some((a) => a.kind === "ghost");
      const content = ghost ? `(${note.fret})` : String(note.fret);
      parts.push(
        uiText(beat.x, y, content, {
          size: 13.5,
          weight: 500,
          fill: engravingTheme.fontColor,
          anchor: "middle",
          cls: "stdb-fret",
          mono: true,
        }),
      );
    }
  }
}
