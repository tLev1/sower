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
| Rendering | alphaTab 1.8.4 (`@coderline/alphatab`) + `@coderline/alphatab-vite` plugin | behind `ScoreRenderer` adapter, swappable |
| Tests | Vitest 3 | 34 tests green |
| Lint | ESLint flat config, typescript-eslint strictTypeChecked | `any` is an error; `scripts/` ignored |
| CI | `.github/workflows/ci.yml` | lint → typecheck → test → build |
| E2E/inspection | Playwright with `channel: "msedge"` | **chromium headless-shell spawn is blocked on this machine** (same cause as corepack spawn failure) — always launch Edge |

## 3. Repository layout

```
C:\dev\stdBd
├── apps/web/                  React app (composition only)
│   └── src/
│       ├── App.tsx            wires document + renderer + editor + transport
│       ├── features/editor/   caret.ts (pure nav logic + tests),
│       │                      useEditor.ts (state + keymap + click handling),
│       │                      ScoreEditor.tsx (canvas + status bar)
│       ├── features/playback/TransportBar.tsx
│       ├── services/score-store.ts   IndexedDB load/save + debounced autosave
│       ├── demo/demoScore.ts  2-bar Em pentatonic demo (initial document)
│       └── styles/global.css  dark theme, tokens mirrored as CSS vars
├── packages/core/             PURE domain — zero dependencies
│   └── src/
│       ├── model/score.ts     Score/Track/Bar/Voice/Note, branded ids
│       │                      (TrackId/BarId/NoteId), 480 ticks per quarter
│       ├── commands/          commands.ts (pure applyCommand), score-document.ts
│       │                      (ScoreDocument: snapshot undo/redo, subscribe, reset)
│       └── operations/        tempoAtBar, barStartTime, validateBar, id allocator
├── packages/render/           ScoreRenderer + ScorePlayer + ScoreInteraction
│   │                          interfaces; alphatab-adapter:
│   └── src/alphatab-adapter/
│       ├── alpha-tex-converter.ts   core Score → alphaTex (fully unit-tested)
│       └── alphatab-renderer.ts     AlphaTabApi owner: render, play, positionAt
│                                  (click hit-testing), getBarRect (caret overlay)
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
pnpm test                # Vitest, all packages (34 tests)
pnpm build               # typecheck + vite build
node scripts/inspect-page.mjs     # with dev server running; screenshot → C:\dev\temp\opencode\page.png
node scripts/interact-test.mjs    # interaction regression (uses real mouse/keys)
```

Git repo initialized on `main`; make commits as you go (conventional commits).

## 5. What is implemented

### Phase 0 — Foundation (complete)
- Monorepo, strict toolchain, CI, design tokens package.
- Core model: immutable `Score` (title/artist/tracks/bars), `Track` (instrument,
  clef, tuning, GM program, volume/pan/mute/solo), `Bar` (time sig, key change,
  tempo, voices), `Note` (pitch, string/fret, start/duration in ticks, velocity,
  articulations union type). Branded id types prevent id mix-ups.
- Event-sourced editing: pure `Command` variants (setNotePitch, setNoteDuration,
  addNote, removeNote, setTrackInstrument) applied via `applyCommand` (returns
  new immutable Score, throws on dangling refs). `ScoreDocument` = editing
  session with exact snapshot history (ids survive undo/redo), maxHistory,
  subscribe/notify, `reset()` for file loads.
- Adapter interfaces: `ScoreRenderer` (mount/loadScore/dispose),
  `ScorePlayer` (play/pause/stop/toggle/isPlaying/onStateChange),
  `ScoreInteraction` (onScoreClicked → `ClickedPosition {barIndex, tick,
  stringIndex}`) — the app NEVER imports alphaTab directly.
- `AlphaTabConverter`: core Score → alphaTex string (validated by parsing our
  output with alphaTab's own `AlphaTexImporter` in tests — the correctness oracle).

### Phase 1a — Guitar tab editing (complete)
- **Rendering**: alphaTab SVG engine, dark-theme glyph/staff colors, demo score
  renders notation + TAB. Playback works (alphaSynth, soundfont `/soundfont/sonivox.sf3`).
- **Editing session**: `useEditor` hook owns caret + keymap; document autosaves
  to IndexedDB (600ms debounce) and restores on reload.
- **Entry model** (guitarist workflow, all verified in real browser):
  - Digits 0-9 place/replace fret at caret (pitch = open-string midi + fret);
    creating a new beat auto-advances to next eighth-note step (fast riff entry);
    adding to a beat that already has notes (chord tone) keeps the position.
  - ↑/↓ change string; right after a placement they RETURN to the placed tick
    (`lastPlacedRef`) so chords build as `3 ↓ 3 ↓ 0`. ←/→ move by grid step
    (wrap across bars) and clear lastPlaced.
  - Backspace deletes note at caret or steps left. Ctrl+Z / Ctrl+Shift+Z /
    Ctrl+Y = undo/redo. Space = play/pause.
- **Click-to-position**: `AlphaTabRenderer.positionAt(clientX, clientY)` does
  full hit-testing via `boundsLookup` → nearest staff system/master bar/beat,
  and resolves the exact TAB string line under the cursor (line geometry:
  lines centered in tab staff realBounds, spacing = `engravingSettings.
  oneStaffSpace * display.scale`; tab staff = last BarBounds sorted by y).
  Clicking notation area moves bar/tick, keeps current string.
- **Caret overlay**: blue box over current master bar via `getBarRect`.
- Status bar: bar/string/step readout, keymap hint, string pills (E4 B3 G3 D3 A2 E2).

## 6. Critical gotchas (learned the hard way — do not re-learn)

1. **alphaTex syntax (v1.8)**: time signature is `\ts(4 4)` (NOT `\time 4/4` —
   parser rejects it). No `.` metadata separator needed. Durations `:1 :2 :4 :8
   :16 :32` before notes; rests `:4 r`; chords `:4 (0.1 3.2)`; bar separator `|`.
   Validate with `AlphaTexImporter` (in Node, no DOM needed) — see
   `packages/render/test/alpha-tex-import.test.ts`.
2. **String numbering is mirrored**: alphaTex note suffix `fret.string` counts
   1-based from the TOP line (high E = 1). alphaTab MODEL `Note.string` counts
   1-based from the LOWEST (high E = 6). Core model is 0-based highest-first.
   Conversions: tex = core.string + 1; clicked model string s → core visual
   index = stringCount − s.
3. **Tick resolutions differ**: alphaTab = 960 ticks/quarter, core = 480 →
   divide by 2 (`ALPHATAB_TICKS_PER_QUARTER` in the adapter).
4. **Asset paths under Vite**: alphaTab's default fontDirectory resolves
   relative to the bundled script and breaks → set `core.fontDirectory: "/font/"`.
   Soundfont must be the exact file `/soundfont/sonivox.sf3` (directory URL
   gets the SPA fallback → "not a valid Soundfont2 file"). Fonts/soundfont are
   copied into `apps/web/public/` by the alphatab-vite plugin (gitignored).
5. **Dark theme**: set `display.resources` colors (mainGlyphColor etc.) in
   alphaTab settings — default is black-on-transparent, invisible on dark UI.
6. **alphaTab API quirks**: player is lazy (`api.player` may be null until
   ready — re-attach `stateChanged` forwarding on loadScore too);
   `beat.displayStart` is the bar-relative tick (use for hit-testing);
   `beat.voice.bar.index` = master bar index for single-track scores.
7. **Keyboard focus**: editing keys are handled at `window` level (guard:
   `isTextEntryTarget`) — do NOT rely on focus on the score div (alphaTab
   surface steals it). React `onKeyDown` was removed deliberately.
8. **Windows quirks**: corepack and chromium-headless-shell spawn fail
   ("spawn UNKNOWN") → pnpm via npm -g, Playwright via `channel: "msedge"`.
   After `pnpm install` you may need `pnpm approve-builds esbuild` once.
   In PowerShell, prefer `pnpm run dev` if plain `pnpm dev` is intercepted by
   the user's shell profile (one unresolved environment oddity).
9. **Debug hook**: `window.__stdbRenderer` exposes the AlphaTabRenderer in the
   browser (used by scripts and future E2E).
10. Tests use non-null assertions freely (`**/test/**` eslint override);
    production code must not.

## 7. Verification status (last run: all green)

- lint / typecheck / 34 unit tests / production build
- Browser-verified via `scripts/interact-test.mjs`:
  - click on TAB number → `Bar 1 · String 1 · Step 1` ✓
  - click empty A2 line → `Bar 1 · String 5 · Step 3` ✓
  - chord tones stay on the beat ✓ (`chordTonesStayed: true`)
  - new note on empty beat auto-advances ✓ (`createAdvanced: true`)
  - ↓ after placement returns to placed tick ✓ (`downReturned: true`)
- No page errors; only console noise is the missing favicon (cosmetic TODO).

## 8. Known gaps / next steps (in order)

1. **Incremental rendering (Phase 1c, top priority)**: every edit re-sends the
   full score through `api.tex()` → re-parse/re-render flash. Move to direct
   alphaTab model updates or model-level editing so edits feel instant. This is
   THE premium-feel blocker.
2. **Caret UX**: replace bar-highlight box with a thin caret line + string hover
   feedback + selection model.
3. **Bar management**: add/remove/duplicate bars (completes Phase 1a).
4. **Durations**: fixed eighth grid; add note-value selection (1/4, 1/2, dots,
   triplets) — converter `durationName()` already maps ticks.
5. Phase 1b: notation-only view toggle, articulations, GP/MusicXML/MIDI import,
   PDF/MusicXML/MIDI export.
6. Phase 1c prototype (timebox 2 weeks): drag-note pitch/duration + hum-a-correction
   input (monophonic pitch detection, WASM). Pivot to click/drag-only if feel fails.
7. Phase 2: accounts/sync/billing, practice tools (loop, tempo %, metronome, tuner).
8. Phase 3+: AI (chord-chart autopilot first), live session (latency architecture
   is specified in docs/ARCHITECTURE.md), arranger, per docs/ROADMAP.md.
9. Minor: favicon; fix weak `undoChord` assertion in interact-test.mjs; mixer UI
   (Track model already has volume/pan/mute/solo).
10. Naming: decide (Adnoto leads), then domain/trademark check + favicon/branding.

## 9. Decisions already made (do not relitigate without reason)

- Own immutable score model + event-sourced commands; MusicXML compatibility via
  adapters (not MusicXML as internal format).
- alphaTab behind adapters; alphaTex as the renderer interchange (validated by
  importer round-trip tests).
- Web-first (TS/React), desktop/iPad shells later (Tauri likely).
- Window-level keyboard handling; premium = consistency + motion + zero-latency
  feedback, enforced via design tokens (`packages/ui`).
- Monetization: freemium subscription; chord-chart autopilot = first AI paywall;
  client-side WASM inference preferred (cost + privacy).
- Solo-dev rules: ship usable every ~2 weeks, build in public from first usable
  milestone, prototype risky UX before deep investment.
