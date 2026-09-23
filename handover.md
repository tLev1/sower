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
| Tests | Vitest 3 | 54 tests green (28 core + 16 render + 10 web) |
| Lint | ESLint flat config, typescript-eslint strictTypeChecked | `any` is an error; `scripts/` ignored |
| CI | `.github/workflows/ci.yml` | lint → typecheck → test → build |
| E2E/inspection | Playwright with `channel: "msedge"` | **chromium headless-shell spawn is blocked on this machine** — always launch Edge |

## 3. Repository layout

```
C:\dev\stdBd
├── apps/web/                  React app (composition only)
│   └── src/
│       ├── App.tsx            wires document + engine + editor + transport;
│       │                      prewarms audio on the first user gesture
│       ├── features/editor/   caret.ts (pure nav logic + duration helpers +
│       │                      tests), useEditor.ts (state + keymap + click
│       │                      handling + entry duration + measure ops),
│       │                      ScoreEditor.tsx (canvas + status bar),
│       │                      DurationPicker.tsx, SheetMenu.tsx (context
│       │                      menu + tempo/meter popovers)
│       ├── features/playback/TransportBar.tsx (unit-aware tempo display)
│       ├── services/score-store.ts   IndexedDB load/save + debounced autosave
│       ├── demo/demoScore.ts  2-bar Em pentatonic demo (initial document)
│       └── styles/global.css  dark theme, tokens as CSS vars, Bravura @font-face
├── packages/core/             PURE domain — zero dependencies
│   └── src/
│       ├── model/score.ts     Score/Track/Bar/Voice/Note, branded ids, 480 tpq,
│       │                      Bar.tempoUnit (notated beat unit)
│       ├── commands/          commands.ts (pure applyCommand), score-document.ts
│       └── operations/        tempoMarkAt/quarterBpmOf/tempoAtBar, barStartTime,
│                              validateBar, id allocator
├── packages/render/           ScoreRenderer + ScorePlayer + ScoreInteraction
│   └── src/engine/            THE ENGINE (in-house, since ADR-003):
│       ├── layout.ts          pure Score → geometry (systems/bars/beats,
│       │                      hit-testing, caret/playhead anchors) — tested
│       ├── engraving.ts       layout → inline SVG (Bravura glyphs, TAB staff,
│       │                      beams, rests, header, metronome tempo marks)
│       │                      + markerHitAreas for the editable marks
│       ├── engine.ts          StdbdEngine: mount/load/positionAt/setCaret/
│       │                      setPlayhead/onPositionChanged/prewarm,
│       │                      sheet-marker clicks, context menu (right-click
│       │                      + touch long-press), dispose
│       ├── player.ts          WebAudioPlayer (Karplus-Strong, tempo map with
│       │                      beat units, lookahead scheduler, prewarm)
│       ├── smufl.ts           SMuFL codepoints (Bravura, incl. metronome marks)
│       └── theme.ts           engraving colors from @stdbd/ui tokens
├── packages/audio/            SynthEngine + LatencyProbe contracts (no impl yet)
├── packages/ui/               design tokens (colors/motion/spacing + liveInput budgets)
├── scripts/
│   ├── inspect-page.mjs       dev page in headless Edge: console errors, DOM, screenshot
│   ├── interact-test.mjs      E2E regression: click precision, chord flow, entry model
│   ├── probe-transport.mjs    play-from-selection + tempo/meter edit verification
│   ├── probe-sheet-v2.mjs     instant-play latency, sheet popovers, context menu,
│   │                          duration palette (the 2026-09 batch)
│   ├── visual-v2.mjs          screenshots: tempo popover, 7/8 sheet, context menu
│   ├── probe-sync.mjs         playhead continuity sampling (frozen-frame / jump detector)
│   ├── probe-buttons.mjs      measure +/− controls (real mouse clicks)
│   ├── probe-frets.mjs        two-digit fret entry + ledger overhang verification
│   ├── probe-play.mjs         playhead visibility while playing
│   ├── probe-timesig.mjs      Bravura time-sig glyph metric probe (canvas TextMetrics)
│   └── zoom-staves.mjs        2× crop screenshots of the staves for visual review
├── docs/                      ROADMAP.md, ARCHITECTURE.md, ADRs/
└── handover.md                this file
```

## 4. Commands

```bash
pnpm install
pnpm dev                 # Vite dev server → http://localhost:5173
pnpm lint                # ESLint (root, flat config)
pnpm typecheck           # tsc --noEmit per package
pnpm test                # Vitest, all packages (46 tests)
pnpm build               # typecheck + vite build
node scripts/inspect-page.mjs     # with dev server running; screenshot → C:\dev\temp\opencode\page.png
node scripts/interact-test.mjs    # interaction regression (uses real mouse/keys)
node scripts/probe-sheet-v2.mjs   # instant-play latency + sheet editing batch (15 checks)
node scripts/probe-playhead-v3.mjs # playhead-at-selection, carry-over notes, rest fill, mid-system meter change
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
  key sigs, tempo marks), JetBrains Mono for TAB fret numbers + bar numbers,
  proportional beat spacing (sqrt-duration), metrical beams (4/4 beams
  eighths in groups of 4, 3/4 in 3, 6/8 in 3 — stems follow the
  farthest-from-middle-line rule, secondary beams for 16ths/32nds),
  title/artist/tempo header, bar numbers at system starts, per-bar tempo
  marks, final double barline.
- **Playback (WebAudio v1)**: Karplus-Strong plucked-string synth with
  articulation awareness (palmMute → short+dark, letRing → long, ghost →
  quiet), chord strum stagger (~11 ms, low strings first), ±5 cent detune,
  velocity→gain curve, master compressor + generated-impulse reverb send.
  Playhead (glowing line) + auto-scroll while playing; resumes from pause
  offset; restarts from caret after stop. Sync: the ~1 s of events around
  the start position pre-generates their pluck buffers synchronously
  (`primeUpcoming`) and the rest primes in idle chunks, so nothing hitches
  mid-bar; the playhead moves on the NOTATED grid starting exactly at the
  selection (no device-latency compensation — it must not appear to wait on
  long notes); playhead ticks are fractional (continuous motion, no
  per-grid jumps); pause/stop fade out via the master gain (~110 ms) instead
  of hard-cutting sources. Notes that began earlier but still SOUND at the
  start position join in immediately with their remaining duration
  (`fireCarryOverNotes`) — mid-phrase play has no silent gap. Auto-scroll is
  vertical-only and smooth (systems always fit the view width).
- **Notation-accurate rest filling** (Gould, "Behind Bars"): empty measures
  take a single whole rest; other gaps decompose greedily into the longest
  standard rests, half rests only aligned to the half bar, and compound
  meters (x/8, x/16 with a multiple-of-3 numerator) never let a rest cross a
  dotted-beat boundary (6/8 after a quarter → eighth + quarter + eighth).
  Unbeamed quarter/half notes have stems but NO flags (flags only exist on
  eighth values and shorter).
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
- **Transport editing**: the transport bar has an editable BPM field
  (commit on Enter/blur → `setBarTempo`, clamped 20-400, keeping the current
  beat unit) and a meter selector (`setTimeSignature`, applied from the caret
  bar until the NEXT differing signature — later meter changes are
  preserved; one undo entry per committed change, not per keystroke). The
  transport shows the EFFECTIVE notated tempo at the caret bar
  (`tempoMarkAt` — BPM + unit glyph). Notes overflowing a narrowed meter
  stay in the model but are ignored by layout/playback overflow handling
  (known v1 limit).
- **Tempo beat units (notation-accurate)**: `Bar.tempoUnit` stores the ticks
  of the notated beat unit (240 = ♪, 360 = ♪., 480 = ♩, 720 = ♩., up to
  3840) — any standard value 32nd→whole with an optional single augmentation
  dot. Playback converts to quarter-BPM (`quarterBpmOf`); the sheet and the
  transport draw the unit via Bravura metronome-mark glyphs (U+ECA2–ECB7).
  Legacy saved scores (no `tempoUnit`) play as quarter BPM — no migration.
- **Sheet-anchored editing**: the engraved time-signature block and every
  tempo equation are clickable (transparent hit rects in the overlay,
  `markerHitAreas` mirrors the engraving geometry) → popovers anchored at the
  click: tempo (beat-unit palette + dotted toggle + BPM input, "Remove tempo
  mark" when a marker exists) and meter (17 preset chips + custom n/d, applied
  from that measure onward). Right-click anywhere on the sheet (desktop) or a
  ~550 ms long-press (touch) opens the score context menu — tempo, time
  signature, insert measure after, delete measure — all targeting the clicked
  measure (`onContextMenu`, `onSheetMarkerClicked` on the engine).
- **Meter changes mid-system** (classical convention — Beethoven/Mozart/
  Rachmaninoff): a time-signature change is engraved AT the measure where it
  begins, even when that bar sits mid-system (digits after the barline, not
  after clef/key), and the junction before it gets a thin-thin double
  barline. `BarBox.timeSignature` is set for system starts AND change bars;
  `BarBox.timeSignatureChange` drives the double barline; layout reserves
  `timeChangeLead` width for mid-system change bars.
- **Note-value entry palette**: a persistent duration mode in the status bar
  (whole/half/quarter/eighth/16th/32nd + dot toggle, Bravura glyphs). Every
  placed note uses the selected value until it is changed; changing it while
  the caret sits on a note also updates that note (`setNoteDuration`);
  chord tones added to an existing beat inherit the beat's duration; new notes
  clamp to the remaining bar capacity; auto-advance skips the placed value's
  length on the eighth grid.
- **Play-from-selection**: the player resolves the start position into
  seconds AFTER the tempo map exists (`beginAt()` rebuilds the timeline
  first — converting earlier, with an empty tempo map, made playback start
  at bar 1). A caret change while stopped/paused clears the pause-resume
  memory, so play always starts from the fresh selection; unchanged
  caret + pause resumes from the paused spot.
- **Instant play latency**: `prewarm()` (called on the first pointer gesture
  anywhere, from the app and the engine) creates + resumes the AudioContext
  and pre-generates pluck buffers in idle chunks, so nothing blocks at play
  time. `play()` itself is synchronous when the context is already running
  (fast path, first note scheduled within ~1 ms) and otherwise resumes the
  context first instead of scheduling against a suspended clock. The
  start-schedule offset dropped from 80 ms to 30 ms. Only the ~1 s of events
  around the start position are generated synchronously; the rest streams in
  the background so no frame stalls.
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
- Overlays live in a separate overlay SVG layered above the static score
  SVG, pointer-events: none, split into two groups: `.stdb-btns` (measure
  controls, rebuilt only on layout changes) and `.stdb-dyn` (caret +
  playhead, updated per frame — the markup memo skips no-op renders).
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
  Deliberately NOT latency-compensated: the playhead tracks the notated
  grid from the selection instantly (the earlier compensation made it wait
  on long notes and start behind the selection).
- Sync details: the events around the start position generate their buffers
  synchronously (`primeUpcoming`), the rest in async chunks
  (`primeRestAsync`); pause/stop fade out via the master gain (~110 ms)
  instead of hard-cutting sources; carry-over notes (started before the
  start point, still sounding) fire immediately with their remaining
  duration. Auto-scroll is vertical-only and smooth.
- **Tempo with beat units**: playback converts notated marks to quarter-BPM
  via `quarterBpmOf` (`Bar.tempo` = BPM of the unit, `Bar.tempoUnit` = unit
  ticks; missing → quarter). The engraver draws unit glyphs + augmentation
  dot from the metronome-marks SMuFL range; `markerHitAreas(layout)` returns
  the editable-mark rects, and the engine renders them as transparent
  `data-stdb-action` rects in the overlay's `.stdb-btns` group.
- **Rest filling + meter changes**: `restFillSeeds(start, end, capacity, ts)`
  in layout.ts encodes the Gould rules (whole rest for empty bars, aligned
  half rests, compound meters fill per dotted-beat segment); groupIntoBeats
  uses it for leading gaps and trailing remainders. Meter changes get their
  own `BarBox.timeSignature` + `timeSignatureChange` (double barline) —
  `drawTimeSignature` positions digits after clef/key on system starts and
  right after the barline on mid-system change bars.

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
6. **Stale dev server**: Vite HMR sometimes serves an outdated App.tsx after
   prop-signature changes (TransportBar crashed on a fresh load with the old
   prop set). If the page errors with props/undefined mismatches right after
   editing React components, kill the node processes and restart
   `pnpm run dev` before debugging the code.
7. **Debug hook**: `window.__stdbRenderer` exposes the StdbdEngine
   (`positionAt`, `pointFor`, `getBarRect`) and `window.__stdbDoc` the
   ScoreDocument — used by scripts and E2E. Measure-button clicks: the
   score's container pointerdown handler must skip `[data-stdb-action]`
   targets — otherwise the caret re-render destroys the button between
   mousedown and click and the click never fires. The last system reserves
   ~6.6 staff spaces of tail room so the buttons stay inside the overlay
   SVG's hit-testable area. Synthetic PointerEvents dispatched from JS do
   NOT carry user activation — Playwright probes must use `page.mouse.*`
   for anything that needs the AudioContext to resume.
8. Tests use non-null assertions freely (`**/test/**` eslint override);
   production code must not.
9. **Bravura vertical metrics in HTML**: music glyphs inside text spans get
   a ~2.4em line box — global.css clamps `line-height: 1` on
   `.duration-btn`, `.glyph-btn`, `.sheet-menu-glyph`, `.glyph-preview`,
   `.field-icon` or buttons stretch to double height.
10. **Headless test audio quirk**: the first AudioContext `resume()` in a
    fresh headless Edge page takes ~600 ms; `probe-sheet-v2.mjs` does a
    warm-up play first, mirroring real usage where `prewarm()` runs on the
    first user gesture.

## 7. Verification status (last run: all green)

- lint / typecheck / 54 unit tests / production build
- Browser-verified via `scripts/interact-test.mjs` (real Edge):
  - click on TAB number → `Bar 1 · String 1 · Step 1` ✓
  - click empty A2 line → `Bar 1 · String 5 · Step 3` ✓
  - chord tones stay on the beat ✓ (`chordTonesStayed: true`)
  - ↓ after placement returns to placed tick ✓ (`downReturned: true`)
  - new note on empty beat auto-advances ✓ (`createAdvanced: true`)
- Playhead continuity probe (`probe-sync.mjs`): zero frozen frames, zero
  jumps across bar crossings ✓
- Play-from-selection + instant latency (`probe-sheet-v2.mjs`, 15/15):
  first note scheduled 0.9 ms after play(), playhead in the selected bar
  within output-latency + 150 ms; tempo mark click → ♪. = 85 commit
  (`tempoUnit 360`); time-sig click → 7/8 engraved; right-click menu with
  tempo/meter/insert/delete; quarter + dotted-quarter palette durations ✓
- Playhead/notation batch (`probe-playhead-v3.mjs`, 5/5): playhead starts at
  the selection (t=1 ms, tick 0) and advances immediately through a quarter
  note (no latency hold); a note still sounding at a mid-phrase start joins
  in at once (source fired at 0.7 ms); 4/4 remainder → quarter + half rests;
  6/8 remainder → eighth + quarter + eighth rests; 6/8 change engraved on
  its mid-system bar (4/4 then 6/8 digit glyphs) ✓
- No page errors; favicon served inline.

## 8. Known gaps / next steps (in order)

1. **Incremental re-render (top priority)**: currently every edit recomputes
   the full layout + SVG string. Fast, but a bar-local layout cache (dirty
   bar → re-render that bar's group only) makes it feel even snappier for
   long scores.
2. **Triplets / tuplet entry**: durations cover dotted values 32nd–whole;
   tuplet grouping (3:2 etc.) still needs a dedicated entry mode and
   engraving support.
3. **Articulation editing + rendering**: palm-mute (PM), bends, slides,
   vibrato, harmonics, ties — the data model has them; the engraver draws
   none of them yet and the editor has no input controls for them.
4. **Notes overflowing a narrowed meter** stay in the model but are ignored
   by layout/playback overflow handling (known v1 limit); consider
   re-flowing or flagging affected bars on meter changes.
5. **Duplicate bars** (completes measure management: add/remove exist,
   duplicate is missing).
6. Phase 1b: notation-only view toggle (engine renders one staff), Guitar
   Pro (.gp3-7)/MusicXML/MIDI import, MusicXML/MIDI/PDF export.
7. Playback v2: per-track mixer (Track model already has volume/pan/mute/
   solo), better synth voices per instrument family, loop sections, tempo %
   (practice tools per ROADMAP Phase 2).
8. Phase 1c prototype (timebox 2 weeks): drag-note pitch/duration +
   hum-a-correction input (monophonic pitch detection, WASM).
9. Phase 2+: accounts/sync/billing, practice tools, AI (chord-chart
   autopilot first), live session (latency architecture in
   docs/ARCHITECTURE.md), arranger — per docs/ROADMAP.md.
10. Naming: decide (Adnoto leads), then domain/trademark check + branding.

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
