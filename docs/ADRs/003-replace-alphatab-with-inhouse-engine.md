# ADR-003 — Replace alphaTab with an in-house engraving engine

Date: 2026-09-22
Status: Accepted

## Context

alphaTab (1.8.4) was the Phase-0 renderer choice, behind the `ScoreRenderer`
adapter. In practice it fell short of the product's non-negotiable premium
feel requirements:

- Every edit re-serialized the score to alphaTex and re-parsed/re-rendered it
  (full `api.tex()` round-trip), causing visible flashes — the #1 premium-feel
  blocker (handover §8.1).
- Look and feel could not be pushed to the level the product requires:
  glyph quality, spacing behavior, caret/interaction model and dark-theme
  treatment are all bounded by alphaTab's engraver.
- Rendering and playback (alphaSynth + soundfont) came as a bundle, while the
  product needs articulation-aware sample engines.
- Hit-testing depended on alphaTab's `boundsLookup` internals (mirrored string
  numbering, 960-tick resolution, lazy player state) — fragile, documented as
  gotchas in handover §6.

## Decision

Build the rendering engine from scratch inside `packages/render/src/engine`:

- `layout.ts` — pure layout: core Score → systems/bars/beats geometry
  (proportional sqrt-duration spacing, system wrapping, staff geometry,
  beam-group assignment, hit-testing + caret/playhead anchors). No DOM,
  fully unit-tested.
- `engraving.ts` — layout → inline SVG. Bravura (SMuFL) glyphs for all
  notation symbols; aligned notation + tablature staves; proportional beat
  spacing; slanted beams with duration-aware secondary beams; premium
  dark-theme colors from `@stdbd/ui` tokens.
- `engine.ts` — `StdbdEngine`: mount/load/dispose, click → `ClickedPosition`
  resolution, caret + playhead overlays (drawn by the engine itself),
  ResizeObserver relayout, `window.__stdbRenderer` test hook.
- `player.ts` — `WebAudioPlayer`: Karplus-Strong plucked-string synthesis,
  articulation-aware (palm-mute, let-ring, ghost), tempo map, lookahead
  scheduler on the audio clock, per-frame position reporting.

alphaTab and its Vite plugin are removed from the workspace.

## Consequences

- Edits are rendered by re-running a pure layout + SVG string build — no
  parser round-trip; feels instant.
- One dependency fewer; the `ScoreRenderer`/`ScorePlayer`/`ScoreInteraction`
  contracts are unchanged, so the app never touches engine internals.
- MusicXML/Guitar Pro import no longer has an alphaTex bridge to maintain —
  converters target the core model directly.
- The engine is ours to evolve (incremental re-rendering, articulation
  marks, tuplets, selection) without waiting on an upstream project.
- Cost: we own engraving correctness. Mitigated by pure layout tests and a
  browser E2E script.
