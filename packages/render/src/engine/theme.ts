import { colors } from "@sower/ui";

/** Engraving theme — derived from the design tokens in @sower/ui. */
export const engravingTheme = {
  fontColor: colors.text, // glyphs, noteheads, tab numbers
  secondaryColor: colors.textMuted, // bar numbers, ancillary marks
  staffColor: "#3d4657", // staff + tab lines
  barlineColor: "#39414f",
  beamColor: colors.text,
  caretColor: colors.accent,
  playheadColor: colors.accent,
  playheadGlow: "rgba(79, 140, 255, 0.22)",
  noteheadColor: colors.text,
} as const;
