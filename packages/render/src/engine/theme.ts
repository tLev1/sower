import { colors } from "@sower/ui";

/**
 * Engraving theme — derived from the design tokens in @sower/ui.
 * NEVER hardcode a colour in the engraver or the engine overlays: add a
 * field here (or read it from `colors`) so the visual language stays one
 * system.
 */
export const engravingTheme = {
  fontColor: colors.text, // glyphs, noteheads, tab numbers
  secondaryColor: colors.textMuted, // bar numbers, ancillary marks
  mutedColor: colors.textMuted,
  staffColor: "#3d4657", // staff + tab lines
  barlineColor: "#39414f",
  beamColor: colors.text,
  caretColor: colors.accent,
  caretHover: colors.accentHover,
  playheadColor: colors.accent,
  playheadGlow: "rgba(79, 140, 255, 0.22)",
  noteheadColor: colors.text,
  /** Floating controls drawn into the score (measure +/−, drag previews). */
  panelColor: colors.bgPanel,
  panelBorderColor: colors.border,
  panelDeep: "#11151c",
  dangerColor: colors.danger,
} as const;
