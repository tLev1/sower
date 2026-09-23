# stdBd — Handover Document

> Purpose: resume development in a fresh agent session. Read this first, then
> `docs/ROADMAP.md` and `docs/ARCHITECTURE.md`.

## 1. Product vision (one paragraph)

A premium music score & tab creation platform — "Guitar Pro, but better, for all
instruments". Tabs + standard notation from one data model (guitar first, then
piano/drums/bass/violin), AI audio→notation and live transcription (key/tempo
constrained, chromatic notes flagged never auto-corrected), a live setlist
arranger with integrated PDF viewer, practice tools, and marketplace/education
revenue layers. **Non-negotiable product requirements from the owner:**
premium look & feel (smooth, snappy, direct manipulation — drag notes,
hum/sing correction), **high-quality playback sounds** (articulation-aware
sample engines, NOT stock soundfonts), **low input latency** (AudioWorklet
128 samples, note-on < 10ms, per-device calibration), and clean replaceable
architecture (ports & adapters, event-sourced editing).

Owner profile: embedded software engineer (6+ yrs, C/C++/Python/JS),
multi-instrumentalist (guitar main, bass, piano, drums, violin), producer
(Logic/Cubase/Studio One/Pro Tools/FL). Solo developer. Building in public
planned from first usable milestone.

Name is not final — candidates: **Adnoto** (top pick), Selah, Jubal, Tabula,
Rivus, Stilla. Working title/folder: **stdBd** (`C:\dev\stdBd`).

## 2. Stack & environment

| Thing | Choice | Notes |
|---|---|---|
| Package manager | pnpm 12.5.1 | installed via `npm i -g pnpm` (corepack spawn fails on this machine) |
| Node | v24 LTS via Scoop | a second `nodejs` install exists in PATH but has no pnpm |
| Language | TypeScript ~5.9.3, strict + noUncheckedIndexedAccess | **Do NOT upgrade to TS 7** — typescript-eslint doesn't support it yet |
| UI | React 19 + Vite 8 (rolldown) | score canvas is plain TS/DOM, React only wraps chrome |
| Rendering | **stdBd engine (in-house)** — SVG + Bravura SMuFL | `packages/render/src/engine`; alphaTab removed (ADR-003) |
| Playback | WebAudio Karplus-Strong synth (v1) | articulation-aware; sample engines plug in via SynthEngine seam later |
| Fonts | Bravura (public/fonts), Inter Variable + JetBrains Mono Variable (fontsource) | music glyphs + UI/mono type |
| Tests | Vitest 3 | 23 tests green (16 core + 7 render layout) |
| Lint | ESLint flat config, typescript-eslint strictTypeChecked | `any` is an error; `scripts/` ignored |
| CI | `.github/workflows/ci.yml` | lint → typecheck → test → build |
| E2E/inspection | Playwright with `channel: "msedge"` | **chromium headless-shell spawn is blocked on this machine** — always launch Edge |

## 3. Repository layout

```
C:\dev\stdBd
├── apps/web/                  React app (composition only)
│   └── src/
│       ├── App.tsx            wires document + engine + editor + transport
│       ├── features/editor/   caret.ts (pure nav logic + tests),
│       │                      useEditor.ts (state + keymap + click handling),
│       │                      ScoreEditor.tsx (canvas + status bar)
│       ├── features/playback/TransportBar.tsx
│       ├── services/score-store.ts   IndexedDB load/save + debounced autosave
│       ├── demo/demoScore.ts  2-bar Em pentatonic demo (initial document)
│       └── styles/global.css  dark theme, tokens as CSS vars, Bravura @font-face
├── packages/core/             PURE domain — zero dependencies
│   └── src/
│       ├── model/score.ts     Score/Track/Bar/Voice/Note, branded ids, 480 tpq
│       ├── commands/          commands.ts (pure applyCommand), score-document.ts
│       └── operations/        tempoAtBar, barStartTime, validateBar, id allocator
├── packages/render/           ScoreRenderer + ScorePlayer + ScoreInteraction
│   └── src/engine/            THE ENGINE (in-house, since ADR-003):
│       ├── layout.ts          pure Score → geometry (systems/bars/beats,
│       │                      hit-testing, caret/playhead anchors) — tested
│       ├── engraving.ts       layout → inline SVG (Bravura glyphs, TAB staff,
│       │                      beams, rests, header)
│       ├── engine.ts          StdbdEngine: mount/load/positionAt/setCaret/
│       │                      setPlayhead/onPositionChanged/dispose
│       ├── player.ts          WebAudioPlayer (Karplus-Strong, tempo map,
│       │                      lookahead scheduler, articulations)
│       ├── smufl.ts           SMuFL codepoints (Bravura)
│       └── theme.ts           engraving colors from @stdbd/ui tokens
├── packages/audio/            SynthEngine + LatencyProbe contracts (no impl yet)
├── packages/ui/               design tokens (colors/motion/spacing + liveInput budgets)
├── scripts/
│   ├── inspect-page.mjs       dev page in headless Edge: console errors, DOM, screenshot
│   └── interact-test.mjs      E2E regression: click precision, chord flow, entry model
├── docs/                      ROADMAP.md, ARCHITECTURE.md, ADRs/
└── handover.md                this file
```

## 4. Commands

```bash
pnpm install
pnpm dev                 # Vite dev server → http://localhost:5173
pnpm lint                # ESLint (root, flat config)
pnpm typecheck           # tsc --noEmit per package
pnpm test                # Vitest, all packages (23 tests)
pnpm build               # typecheck + vite build
node scripts/inspect-page.mjs     # with dev server running; screenshot → C:\dev\temp\opencode\page.png
node scripts/interact-test.mjs    # interaction regression (uses real mouse/keys)
```

Git repo on `main`; commit as you go (conventional commits).

## 5. What is implemented

### Phase 0 — Foundation (complete)
- Monorepo, strict toolchain, CI, design tokens package.
- Core model: immutable `Score` (title/artist/tracks/bars), `Track`, `Bar`,
  `Note` (pitch, string/fret, start/duration ticks, velocity, articulations).
  Branded id types. Event-sourced editing via pure `Command`s +
  `ScoreDocument` (snapshot undo/redo, subscribe, reset).

### Phase 1a — Guitar tab editing (complete, NEW ENGINE)
- **Rendering (stdBd engine)**: single-track scores render aligned notation +
  TAB staves. Bravura glyphs (clef, time sig, noteheads, rests, accidentals,
  key sigs), JetBrains Mono for TAB fret numbers + bar numbers, proportional
  beat spacing (sqrt-duration), slanted beams (eighth runs beamed per quarter,
  direction follows pitch, secondary beams for 16ths/32nds), title/artist/
  tempo header, bar numbers at system starts, final double barline.
- **Playback (WebAudio v1)**: Karplus-Strong plucked-string synth with
  articulation awareness (palmMute → short+dark, letRing → long, ghost →
  quiet), chord strum stagger (~11 ms, low strings first), ±5 cent detune,
  velocity→gain curve, master compressor + generated-impulse reverb send.
  Playhead (glowing line) + auto-scroll while playing; resumes from pause
  offset; restarts from caret after stop. Sync: all pluck buffers are
  pre-generated on play (`primeBuffers`) so nothing hitches mid-bar; the
  emitted position is compensated by `outputLatency + baseLatency` so the
  playhead tracks what the listener HEARS; playhead ticks are fractional
  (continuous motion, no per-grid jumps); pause/stop fade out via the
  master gain (~110 ms) instead of hard-cutting sources. Auto-scroll is
  vertical-only and smooth (systems always fit the view width; horizontal
  jumps were the old "glitch when crossing measures").
- **Interaction**: `positionAt(clientX, clientY)` → `{barIndex, tick,
  stringIndex}` from pure layout geometry (exact TAB string under cursor).
  `pointFor(...)` inverse for tests. Engine-drawn caret (thin accent line +
  string dot) and playhead overlays.
- **Editing session**: `useEditor` owns caret + window-level keymap (digits
  place frets, ↑/↓ string moves with chord-return, ←/→ grid steps, Backspace,
  Ctrl+Z/Y). Two-digit frets: Ctrl+1/Ctrl+2 opens the entry (status bar shows
  "Fret 1_"), the next digit — plain or still with Ctrl held — completes it
  (frets 10-24, `MAX_FRET`); any other key cancels. Document autosaves to
  IndexedDB (600ms debounce), restores on reload. Bar highlight replaced by
  the engine caret.
- **Notation overhang**: `trackLayouts` scans each track's pitches and
  reserves ledger-line space above/below the staff (`overUp`/`overDown`) so
  high-fret notes (fret 15+ writes 3+ ledger lines) never collide with the
  header or the neighboring system.
- **Measure management**: engine-drawn "+/−" buttons after the final barline
  (SVG, hit-testable, − hidden at 1 bar); `addBar`/`removeBar` commands in
  core; the id allocator seeds from the score and re-syncs on reset (avoids
  id collisions with loaded data — removeBar used to delete two bars).

## 5b. Engine architecture notes (for future work)

- Layout is a pure function: `computeLayout(score, {width})` →
  `LayoutDocument` (systems → bars → per-track `TrackBar` with `Beat[]`).
  Beat `x` is absolute SVG px; every drawing + hit-test call derives from it.
- All engraving colors come from `engravingTheme` (theme.ts), which reads
  `@stdbd/ui` tokens — never hardcode colors in the engraver.
- Coordinate spaces: SVG space (layout coords) vs client coords. The engine
  translates via `staticSvg.getBoundingClientRect()`.
- Overlays (caret/playhead) live in a separate overlay SVG layered above the
  static score SVG — re-rendered cheaply, pointer-events: none.
- Beam groups follow meter conventions (`beamGroupSize`): 4/4 beams eighths
  in groups of 4 (half-bar), 3/4 in 3, 2/4 in 2, compound (6/8) in 3 per
  dotted beat. Stem direction per Gould's rule: the note farthest from the
  middle line decides (ties up). Measures are contiguous — barlines are
  shared between bars, no gaps. Noteheads offset for unisons/seconds
  (`headDxs`); leger lines drawn beyond the staff (`legerPositions`);
  accidentals are key-aware with measure-scoped memory (`accidentalFor`).
- **Playhead track**: the playhead moves on a piecewise-linear knot table
  over ABSOLUTE ticks (`layout.playheadKnots` — one knot per beat column, a
  trailing knot at each system's final barline). Segments within a system
  run unbroken through shared barlines; line wraps step to the next system
  at the boundary tick. `playheadAnchorAt(layout, absTick)` interpolates;
  the player emits `absTick` (bar-start ticks + fractional tick). Clamping
  the playhead per bar (old behavior) froze it at each bar's last beat and
  teleported it across the barline — that was the measure-jump glitch.
- Sync details: all pluck buffers are pre-generated on play
  (`primeBuffers`); the emitted position is compensated by
  `outputLatency + baseLatency` so the playhead tracks what the listener
  HEARS; pause/stop fade out via the master gain (~110 ms) instead of
  hard-cutting sources. Auto-scroll is vertical-only and smooth.

## 6. Critical gotchas (do not re-learn)

1. **Engine lives behind adapter contracts** — `ScoreRenderer` /
   `ScorePlayer` / `ScoreInteraction` in `packages/render/src/renderer.ts`.
   The app must never import `packages/render/src/engine/*` files directly;
   go through `@stdbd/render`'s public API (`StdbdEngine`).
2. **SMuFL glyph alignment**: music glyphs are drawn at font-size = staff
   height (4 × staffSpace); text-anchor `middle` centers them. Time-sig
   digits are baseline-centered and span ±1 staff space (verified via canvas
   TextMetrics) — numerator baseline at staffTop + 1S, denominator at +3S;
   one digit ≈ 1.9 spaces wide. TAB numbers need `+4.8px` baseline offset at
   font-size 13.5.
3. **Guitar pitch convention**: notation staff positions are computed from
   the WRITTEN pitch (sounding + 12 for guitar). `staffPos(midi, isGuitar)`
   returns half-steps above the middle line (positive = higher).
4. **Font loading**: SVG text metrics shift after fonts load → the engine
   re-renders once on `document.fonts.ready`. Bravura is preloaded via
   `<link rel="preload">` to avoid FOUT.
5. **Windows quirks**: corepack and chromium-headless-shell spawn fail
   ("spawn UNKNOWN") → pnpm via npm -g, Playwright via `channel: "msedge"`.
   In PowerShell, prefer `pnpm run dev` over plain `pnpm dev`.
   For long-running dev servers from scripts, use `Start-Process` (jobs die
   with the parent shell).
6. **Debug hook**: `window.__stdbRenderer` exposes the StdbdEngine
   (`positionAt`, `pointFor`, `getBarRect`) — used by scripts and E2E.
   Measure-button clicks: the score's container pointerdown handler must
   skip `[data-stdb-action]` targets — otherwise the caret re-render
   destroys the button between mousedown and click and the click never
   fires. The last system reserves ~6.6 staff spaces of tail room so the
   buttons stay inside the overlay SVG's hit-testable area.
7. Tests use non-null assertions freely (`**/test/**` eslint override);
   production code must not.

## 7. Verification status (last run: all green)

- lint / typecheck / 23 unit tests / production build
- Browser-verified via `scripts/interact-test.mjs` (real Edge):
  - click on TAB number → `Bar 1 · String 1 · Step 1` ✓
  - click empty A2 line → `Bar 1 · String 5 · Step 3` ✓
  - chord tones stay on the beat ✓ (`chordTonesStayed: true`)
  - ↓ after placement returns to placed tick ✓ (`downReturned: true`)
  - new note on empty beat auto-advances ✓ (`createAdvanced: true`)
- No page errors; favicon served inline.

## 8. Known gaps / next steps (in order)

1. **Incremental re-render (top priority)**: currently every edit recomputes
   the full layout + SVG string. Fast, but a bar-local layout cache (dirty
   bar → re-render that bar's group only) makes it feel even snappier for
   long scores.
2. **Articulation rendering**: palm-mute (PM), bends, slides, vibrato,
   harmonics — the data model has them; the engraver doesn't draw them yet.
3. **Bar management**: add/remove/duplicate bars (completes Phase 1a).
4. **Durations**: fixed eighth grid; add note-value selection (1/4, 1/2,
   dots, triplets) — `durationClass()` already maps ticks.
5. Phase 1b: notation-only view toggle (engine renders one staff), GP/
   MusicXML/MIDI import, PDF/MusicXML/MIDI export.
6. Phase 1c prototype (timebox 2 weeks): drag-note pitch/duration +
   hum-a-correction input (monophonic pitch detection, WASM).
7. Playback v2: per-track mixer (Track model already has volume/pan/mute/
   solo), better synth voices per instrument family.
8. Phase 2+: accounts/sync/billing, practice tools, AI (chord-chart
   autopilot first), live session (latency architecture in
   docs/ARCHITECTURE.md), arranger — per docs/ROADMAP.md.
9. Naming: decide (Adnoto leads), then domain/trademark check + branding.

## 9. Decisions already made (do not relitigate without reason)

- Own immutable score model + event-sourced commands; MusicXML compatibility
  via adapters (not MusicXML as internal format).
- **In-house engraving engine** (ADR-003) — do not reintroduce alphaTab or
  any third-party score renderer without revisiting that ADR.
- Web-first (TS/React), desktop/iPad shells later (Tauri likely).
- Window-level keyboard handling; premium = consistency + motion +
  zero-latency feedback, enforced via design tokens (`packages/ui`).
- Monetization: freemium subscription; chord-chart autopilot = first AI
  paywall; client-side WASM inference preferred (cost + privacy).
- Solo-dev rules: ship usable every ~2 weeks, build in public from first
  usable milestone, prototype risky UX before deep investment.
