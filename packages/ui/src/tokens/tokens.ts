/**
 * Design tokens — the single source of truth for the visual language.
 * Premium feel = consistency + motion. Never hardcode colors/timings in UI code.
 */
export const colors = {
  bg: "#0e1116",
  bgElevated: "#161b24",
  bgPanel: "#1c2330",
  border: "#2a3342",
  text: "#e8ecf3",
  textMuted: "#8b95a8",
  accent: "#4f8cff",
  accentHover: "#6b9eff",
  success: "#3ecf8e",
  warning: "#f5a623",
  danger: "#e5534b",
  selection: "rgba(79, 140, 255, 0.18)",
} as const;

export const typography = {
  fontFamily:
    "Inter, 'Segoe UI', system-ui, -apple-system, sans-serif",
  mono: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
  sizeXs: "11px",
  sizeSm: "13px",
  sizeMd: "15px",
  sizeLg: "18px",
  sizeXl: "24px",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 20,
  xl: 32,
} as const;

export const radius = {
  sm: 4,
  md: 8,
  lg: 12,
  full: 9999,
} as const;

/** Motion: one easing family, standard durations. Snappy, never sluggish. */
export const motion = {
  fast: 120,
  base: 180,
  slow: 240,
  easeOut: "cubic-bezier(0.16, 1, 0.3, 1)",
  easeInOut: "cubic-bezier(0.4, 0, 0.2, 1)",
} as const;

/** Latency-critical timing constants for live input feedback. */
export const liveInput = {
  /** Note echo must appear within this budget (ms) of note-on detection. */
  echoBudgetMs: 10,
  /** Snap-to-grid visual settle time (ms) after the echo. */
  snapSettleMs: 150,
} as const;
