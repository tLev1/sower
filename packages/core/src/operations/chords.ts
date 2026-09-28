import type { Tuning } from "../model/index.js";

/**
 * Chord-sheet theory: key-aware chord maps, lead-sheet symbol spelling and
 * guitar voicings, per standard music-theory references (Berklee lead-sheet
 * convention for chord symbols; Kostka–Payne for key/degree relationships;
 * Gould "Behind Bars" for symbol placement on scores).
 */

export interface KeySignature {
  /** Circle-of-fifths position: -7 (Cb) … 0 (C) … +7 (C#). */
  readonly fifths: number;
  readonly mode: "major" | "minor";
}

export type ChordQuality =
  | "major"
  | "minor"
  | "dim"
  | "aug"
  | "sus2"
  | "sus4"
  | "add4"
  | "add9"
  | "maj6"
  | "min6"
  | "dom7"
  | "maj7"
  | "min7"
  | "min7b5"
  | "dim7"
  | "minMaj7"
  | "dom9"
  | "maj9"
  | "min9"
  | "dom11"
  | "min11"
  | "dom13"
  | "maj13";

interface QualitySpec {
  /** Lead-sheet suffix (Berklee convention). */
  readonly suffix: string;
  /** Semitone intervals from the root. */
  readonly intervals: readonly number[];
}

const QUALITIES: Record<ChordQuality, QualitySpec> = {
  major: { suffix: "", intervals: [0, 4, 7] },
  minor: { suffix: "m", intervals: [0, 3, 7] },
  dim: { suffix: "°", intervals: [0, 3, 6] },
  aug: { suffix: "+", intervals: [0, 4, 8] },
  sus2: { suffix: "sus2", intervals: [0, 2, 7] },
  sus4: { suffix: "sus4", intervals: [0, 5, 7] },
  add4: { suffix: "add4", intervals: [0, 4, 5, 7] },
  add9: { suffix: "add9", intervals: [0, 4, 7, 14] },
  maj6: { suffix: "6", intervals: [0, 4, 7, 9] },
  min6: { suffix: "m6", intervals: [0, 3, 7, 9] },
  dom7: { suffix: "7", intervals: [0, 4, 7, 10] },
  maj7: { suffix: "maj7", intervals: [0, 4, 7, 11] },
  min7: { suffix: "m7", intervals: [0, 3, 7, 10] },
  min7b5: { suffix: "m7♭5", intervals: [0, 3, 6, 10] },
  dim7: { suffix: "°7", intervals: [0, 3, 6, 9] },
  minMaj7: { suffix: "m(maj7)", intervals: [0, 3, 7, 11] },
  dom9: { suffix: "9", intervals: [0, 4, 7, 10, 14] },
  maj9: { suffix: "maj9", intervals: [0, 4, 7, 11, 14] },
  min9: { suffix: "m9", intervals: [0, 3, 7, 10, 14] },
  dom11: { suffix: "11", intervals: [0, 4, 7, 10, 14, 17] },
  min11: { suffix: "m11", intervals: [0, 3, 7, 10, 14, 17] },
  dom13: { suffix: "13", intervals: [0, 4, 7, 10, 14, 21] },
  maj13: { suffix: "maj13", intervals: [0, 4, 7, 11, 14, 21] },
};

/** All chord qualities, in menu order (triads, then 6/7, then extended). */
export const CHORD_QUALITIES: readonly ChordQuality[] = [
  "major", "minor", "dim", "aug", "sus2", "sus4", "add4", "add9",
  "maj6", "min6", "dom7", "maj7", "min7", "min7b5", "dim7", "minMaj7",
  "dom9", "maj9", "min9", "dom11", "min11", "dom13", "maj13",
];

const PC_SPELLINGS: readonly (readonly [string, string, string])[] = [
  ["C", "C", "C"],
  ["C", "C♯", "D♭"],
  ["D", "D", "D"],
  ["D", "D♯", "E♭"],
  ["E", "E", "E"],
  ["F", "F", "F"],
  ["F", "F♯", "G♭"],
  ["G", "G", "G"],
  ["G", "G♯", "A♭"],
  ["A", "A", "A"],
  ["A", "A♯", "B♭"],
  ["B", "B", "B"],
];

/**
 * Spells a pitch class for lead-sheet use. Sharp keys (fifths ≥ 1) prefer
 * sharp spellings, flat keys and C major prefer flats (Bb over A♯ etc.).
 */
export function spellRoot(pc: number, fifths: number): string {
  const entry = PC_SPELLINGS[((pc % 12) + 12) % 12];
  if (!entry) return "C";
  return fifths >= 1 ? entry[1] : entry[2];
}

export function chordSymbol(rootPc: number, quality: ChordQuality, fifths: number): string {
  return spellRoot(rootPc, fifths) + QUALITIES[quality].suffix;
}

export function chordIntervals(quality: ChordQuality): readonly number[] {
  return QUALITIES[quality].intervals;
}

export interface ChordChoice {
  readonly rootPc: number;
  readonly quality: ChordQuality;
  readonly symbol: string;
  /** Roman numeral for diatonic chords (e.g. "ii", "V7"). */
  readonly degree?: string;
}

/**
 * The diatonic chord map of a key — the chords "from that key" offered first
 * in the Add-chord menu (triads + the standard 7ths; minor uses natural
 * minor with the harmonic V7).
 */
export function diatonicChords(key: KeySignature): readonly ChordChoice[] {
  // the minor tonic sits a minor third above its relative major (same fifths)
  const majorTonic = key.fifths >= 0 ? (7 * key.fifths) % 12 : (12 - ((-7 * key.fifths) % 12)) % 12;
  const minor = key.mode === "minor";
  const tonicPc = minor ? (majorTonic + 9) % 12 : majorTonic;
  const degrees: readonly { readonly step: number; readonly degree: string; readonly quality: ChordQuality; readonly seventh: ChordQuality }[] = minor
    ? [
        { step: 0, degree: "i", quality: "minor", seventh: "min7" },
        { step: 1, degree: "ii°", quality: "dim", seventh: "min7b5" },
        { step: 2, degree: "III", quality: "major", seventh: "maj7" },
        { step: 3, degree: "iv", quality: "minor", seventh: "min7" },
        { step: 4, degree: "v", quality: "minor", seventh: "min7" },
        { step: 5, degree: "VI", quality: "major", seventh: "maj7" },
        { step: 6, degree: "VII", quality: "major", seventh: "dom7" },
      ]
    : [
        { step: 0, degree: "I", quality: "major", seventh: "maj7" },
        { step: 1, degree: "ii", quality: "minor", seventh: "min7" },
        { step: 2, degree: "iii", quality: "minor", seventh: "min7" },
        { step: 3, degree: "IV", quality: "major", seventh: "maj7" },
        { step: 4, degree: "V", quality: "major", seventh: "dom7" },
        { step: 5, degree: "vi", quality: "minor", seventh: "min7" },
        { step: 6, degree: "vii°", quality: "dim", seventh: "min7b5" },
      ];
  // scale steps in semitones (major / natural minor)
  const scale = minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const out: ChordChoice[] = [];
  for (const d of degrees) {
    const rootPc = (tonicPc + (scale[d.step] ?? 0)) % 12;
    out.push({ rootPc, quality: d.quality, symbol: chordSymbol(rootPc, d.quality, key.fifths), degree: d.degree });
    out.push({
      rootPc,
      quality: d.seventh,
      symbol: chordSymbol(rootPc, d.seventh, key.fifths),
      degree: `${d.degree}7`,
    });
  }
  return out;
}

/** All 12 roots × all qualities (the full chord map). */
export function allChords(fifths: number): readonly ChordChoice[] {
  const out: ChordChoice[] = [];
  for (let pc = 0; pc < 12; pc++) {
    for (const quality of CHORD_QUALITIES) {
      out.push({ rootPc: pc, quality, symbol: chordSymbol(pc, quality, fifths) });
    }
  }
  return out;
}

export interface VoicedNote {
  /** Visual string index (0 = highest). */
  readonly string: number;
  readonly fret: number;
  readonly pitch: number;
}

/** One playable position of a chord (inversion + fretboard location). */
export interface ChordVoicing {
  readonly notes: readonly VoicedNote[];
  /** Human label: "Root", "1st inv.", "2nd inv." … per the bass tone. */
  readonly label: string;
  /** Tab pattern low→high, e.g. "x 3 2 0 1 0". */
  readonly frets: string;
}

function inversionLabel(rootPc: number, bassPc: number, intervals: readonly number[]): string {
  const semis = ((bassPc - rootPc) % 12 + 12) % 12;
  const idx = intervals.findIndex((i) => i % 12 === semis);
  switch (idx) {
    case 0:
      return "Root";
    case 1:
      return "1st inv.";
    case 2:
      return "2nd inv.";
    case 3:
      return "3rd inv.";
    default:
      return `${semis} in bass`;
  }
}

function fretsPattern(notes: readonly VoicedNote[], count: number): string {
  const byString = new Map<number, number>();
  for (const n of notes) byString.set(n.string, n.fret);
  const parts: string[] = [];
  for (let v = count - 1; v >= 0; v--) parts.push(byString.has(v) ? String(byString.get(v)) : "x");
  return parts.join(" ");
}

/**
 * All playable positions of a chord across the neck — root position and
 * inversions on every octave (the same space the Guitar Chords tools
 * enumerate as "voicing N of M"): one shape per bass note × fretboard
 * window, all chord tones sounding, max 4 frets span (open strings free).
 */
export function enumerateVoicings(
  rootPc: number,
  quality: ChordQuality,
  tuning: Tuning,
  maxFret = 12,
): readonly ChordVoicing[] {
  const lowestFirst = [...tuning.strings];
  const count = lowestFirst.length;
  if (count === 0) return [];
  const intervals = chordIntervals(quality);
  const pcs = [...new Set(intervals.map((i) => ((rootPc + i) % 12 + 12) % 12))];
  const pcSet = new Set(pcs);
  const openOf = (visual: number): number => lowestFirst[count - 1 - visual] ?? 60;
  const found = new Map<string, ChordVoicing>();

  const addShape = (notes: readonly VoicedNote[]): void => {
    if (notes.length < 2) return;
    const sounding = new Set(notes.map((n) => ((n.pitch % 12) + 12) % 12));
    for (const pc of pcs) if (!sounding.has(pc)) return; // all chord tones
    const fretted = notes.map((n) => n.fret).filter((f) => f > 0);
    const span = fretted.length > 0 ? Math.max(...fretted) - Math.min(...fretted) : 0;
    if (span > 3) return; // playable 4-fret window (opens are free)
    const key = fretsPattern(notes, count);
    if (found.has(key)) return;
    const bass = [...notes].sort((a, b) => b.string - a.string)[0];
    if (!bass) return;
    found.set(key, {
      notes: [...notes].sort((a, b) => a.string - b.string),
      label: inversionLabel(rootPc, ((bass.pitch % 12) + 12) % 12, intervals),
      frets: key,
    });
  };

  // one shape per bass tone × fretboard position (any chord tone may be the
  // bass — that is what makes the inversions), filling the higher strings
  // with the remaining tones (doublings allowed), ascending in pitch
  for (let start = count - 1; start >= 0; start--) {
    for (let bassFret = 0; bassFret <= maxFret; bassFret++) {
      const bassPitch = openOf(start) + bassFret;
      const bassPc = ((bassPitch % 12) + 12) % 12;
      if (!pcSet.has(bassPc)) continue;
      const low = Math.max(0, bassFret - 3);
      const high = Math.min(maxFret, bassFret + 3);
      const seed: VoicedNote[] = [{ string: start, fret: bassFret, pitch: bassPitch }];
      const covered = new Set<number>([bassPc]);
      const walk = (v: number, prevPitch: number, pcsHit: Set<number>, shape: readonly VoicedNote[]): void => {
        if (v < 0) {
          if (pcsHit.size === pcs.length) addShape(shape);
          return;
        }
        // the string may be muted (interior mutes are valid guitar shapes)
        walk(v - 1, prevPitch, pcsHit, shape);
        const open = openOf(v);
        for (let f = low; f <= high; f++) {
          const pitch = open + f;
          if (pitch <= prevPitch) continue;
          const pc = ((pitch % 12) + 12) % 12;
          if (!pcSet.has(pc)) continue;
          const next = new Set(pcsHit);
          next.add(pc);
          walk(v - 1, pitch, next, [...shape, { string: v, fret: f, pitch }]);
        }
      };
      walk(start - 1, bassPitch, covered, seed);
    }
  }

  return [...found.values()].sort((a, b) => {
    const fa = Math.min(...a.notes.map((n) => n.fret));
    const fb = Math.min(...b.notes.map((n) => n.fret));
    return fa - fb || b.notes.length - a.notes.length;
  });
}

/**
 * Builds a playable guitar voicing for a chord: the root on the lowest
 * possible string, each higher string taking the nearest chord tone above
 * the previous note (the same shape principle as open-position chords —
 * e.g. D major on standard tuning: X X 0 2 2).
 */
export function voiceChord(
  rootPc: number,
  quality: ChordQuality,
  tuning: Tuning,
  maxFret = 12,
): readonly VoicedNote[] {
  const lowestFirst = [...tuning.strings];
  const count = lowestFirst.length;
  if (count === 0) return [];
  const pcs = [...new Set(chordIntervals(quality).map((i) => ((rootPc + i) % 12 + 12) % 12))];
  const openOf = (visual: number): number => lowestFirst[count - 1 - visual] ?? 60;
  const fretsOf = (visual: number, pc: number, minPitch: number): { fret: number; pitch: number } | null => {
    const open = openOf(visual);
    for (let fret = 0; fret <= maxFret; fret++) {
      const pitch = open + fret;
      if (pitch >= minPitch && ((pitch % 12) + 12) % 12 === pc) return { fret, pitch };
    }
    return null;
  };

  let best: VoicedNote[] = [];
  let bestScore = Number.NEGATIVE_INFINITY;
  // try the root on every string; keep the most playable shape
  for (let start = count - 1; start >= 0; start--) {
    const rootFret = fretsOf(start, pcs[0] ?? 0, 0);
    if (!rootFret || rootFret.fret > 7) continue;
    const notes: VoicedNote[] = [{ string: start, fret: rootFret.fret, pitch: rootFret.pitch }];
    let prevPitch = rootFret.pitch;
    let prevFret = rootFret.fret;
    let tone = 1;
    for (let v = start - 1; v >= 0 && tone < pcs.length; v--) {
      const pc = pcs[tone % pcs.length] ?? 0;
      const hit = fretsOf(v, pc, prevPitch + 1);
      // skip strings that can't take the next tone compactly
      if (!hit || hit.fret > maxFret || hit.fret > prevFret + 5) continue;
      notes.push({ string: v, fret: hit.fret, pitch: hit.pitch });
      prevPitch = hit.pitch;
      prevFret = hit.fret;
      tone++;
    }
    const frets = notes.map((n) => n.fret);
    const span = Math.max(...frets) - Math.min(...frets);
    const score = notes.length * 10 - span * 1.5 - Math.max(...frets) * 0.35;
    if (score > bestScore) {
      bestScore = score;
      best = notes;
    }
  }
  return best;
}
