/**
 * SMuFL glyph codepoints (Bravura). Staff space convention: one em of the
 * music font equals 4 staff spaces, i.e. the height of a five-line staff.
 */
export const G = {
  gClef: 0xe050,
  gClef8vb: 0xe052,
  fClef: 0xe062,
  noteheadWhole: 0xe0a2,
  noteheadHalf: 0xe0a3,
  noteheadBlack: 0xe0a4,
  augmentationDot: 0xe1e7,
  flag8thUp: 0xe240,
  flag16thUp: 0xe242,
  flag32ndUp: 0xe244,
  flag8thDown: 0xe241,
  flag16thDown: 0xe243,
  flag32ndDown: 0xe245,
  accidentalFlat: 0xe260,
  accidentalNatural: 0xe261,
  accidentalSharp: 0xe262,
  timeSig0: 0xe080,
  timeSig1: 0xe081,
  timeSig2: 0xe082,
  timeSig3: 0xe083,
  timeSig4: 0xe084,
  timeSig5: 0xe085,
  timeSig6: 0xe086,
  timeSig7: 0xe087,
  timeSig8: 0xe088,
  timeSig9: 0xe089,
  timeSigCommon: 0xe08a,
  restWhole: 0xe4e3,
  restHalf: 0xe4e4,
  restQuarter: 0xe4e5,
  rest8th: 0xe4e6,
  rest16th: 0xe4e7,
  rest32nd: 0xe4e8,
  articAccentAbove: 0xe4a0,
  articStaccatoAbove: 0xe4a2,
  // metronome marks range — balanced stems for tempo equations
  metNoteWhole: 0xeca2,
  metNoteHalfUp: 0xeca3,
  metNoteQuarterUp: 0xeca5,
  metNote8thUp: 0xeca7,
  metNote16thUp: 0xeca9,
  metNote32ndUp: 0xecab,
  metAugmentationDot: 0xecb7,
  tupletBracket: 0xe880, // reserved
} as const;

export type GlyphName = keyof typeof G;

/** Music font family name — must match the @font-face in global.css. */
export const MUSIC_FONT = "Bravura";
