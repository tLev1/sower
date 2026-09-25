# Sower — Product Roadmap

> Name: **Sower** (decided).
> Solo developer. Web-first (TypeScript/React), packaged for desktop/iPad later.
> Status snapshot: **Phase 1a complete on the in-house engine** — see §Current
> status. Handover details in `handover.md`, architecture in
> `docs/ARCHITECTURE.md`, engine decision in `docs/ADRs/003-*`.

## Locked requirements

- **Premium UX**: every interaction must feel smooth, snappy, deliberate. Design tokens, motion spec, 60fps score canvas. Direct manipulation (drag notes) + hum/sing correction are flagship interactions — prototype early.
- **High-quality playback sounds** (explicit user requirement): premium sampled instrument sets, articulation-aware triggering (strum offsets, palm mutes, round-robin drums), NOT stock soundfonts. Architecture must allow plugging sample engines into `SynthEngine`.
- **Latency (live input)**: AudioWorklet @ 128 samples, zero allocation in audio thread, note-on < 10ms, per-device calibration, two-stage display (instant echo → grid snap).
- **Clean architecture**: pure core, ports & adapters, event-sourced commands. Any subsystem replaceable without rippling.

## Current status snapshot (2026-09)

| Area | State |
|---|---|
| Core model + commands | ✅ immutable Score, branded ids, event-sourced commands incl. bar/tempo/meter editing, undo/redo |
| Renderer | ✅ in-house SVG engraving engine (ADR-003): notation + TAB, Bravura/SMuFL, metrical beaming, ledger lines, accidentals, tempo marks |
| Playback | ✅ WebAudio v1: Karplus-Strong plucked-string synth, articulation-aware, tempo map, look-ahead scheduler, latency-compensated playhead, fade pause/stop, play-from-selection |
| Editing | ✅ fret entry 0-9 + two-digit (10-24), chord entry flow, caret navigation, measure +/−, undo/redo, IndexedDB autosave |
| Transport | ✅ play/pause/stop, editable BPM, meter selector (applies from caret bar) |
| Missing for Phase 1b | durations UI, articulation editing/rendering, notation-only toggle, import/export |

## Phases

### Phase 0 — Foundation ✅ (complete)
- [x] Monorepo (pnpm workspaces), TS strict, ESLint strictTypeChecked, CI
- [x] Core score model + event-sourced commands + tests
- [x] Renderer abstraction (`ScoreRenderer`/`ScorePlayer`/`ScoreInteraction`)
- [x] Audio adapter contracts (SynthEngine, LatencyProbe)
- [x] Design tokens package
- [x] Vertical slice: demo score → render

### Phase 1a — Guitar tab editing ✅ (complete — rebuilt on the in-house engine)
- [x] Score document store (autosave, IndexedDB persistence)
- [x] Undo/redo history over command stream
- [x] **In-house engraving engine** (ADR-003 — alphaTab removed): SVG + Bravura,
      notation + TAB, standard notation rules (metrical beaming per meter,
      Gould stem rule, shared barlines, leger lines, seconds offsets,
      key-aware accidentals, correct time-sig placement, notation overhang)
- [x] Playback v1: Karplus-Strong synth (articulation-aware), strum stagger,
      reverb + compressor; latency-compensated continuous playhead; smooth
      measure transitions (absolute-tick knot track); play-from-selection;
      fade pause/stop; vertical auto-scroll
- [x] Guitar TAB editing: add/remove/replace notes, frets 0-9 + two-digit
      entry (Ctrl+1/2 → 10-24), chord flow (place → ↓ returns to placed tick),
      caret navigation, click-to-position hit-testing
- [x] Measure management: append/remove via engine-drawn +/− controls
- [x] Keyboard-first shortcuts (guitarist workflow)
- [x] Transport: BPM field + meter selector (event-sourced `setBarTempo` /
      `setTimeSignature`, undoable, tempo marks engraved)
- [x] Scheduler/visual sync: primeBuffers, outputLatency compensation,
      fractional playhead ticks, fade-out pause/stop

### Phase 1b — Notation + articulations (~4 wks)
- [x] Note-value selection (1/4, 1/2, whole, 16ths; dots) — duration palette
      + `setNoteDuration` wiring + caret follows the selected value (exact
      advance, value-grid snapping); mixed values beam correctly
- [x] Rest entry — `B` writes a rest of the selected value (configurable via
      the same palette + dot), editable like notes, measure auto-adjusts
- [ ] Triplets / tuplet entry (3:2 etc.) — needs a tuplet model + entry mode
- [x] Simple articulations — palm mute ("P.M." above the staff), staccato
      (dot), accent, ghost (parenthesized frets), let-ring: toggle on the
      caret note with M/S/R/G/A, engraved marks, playback honors all
- [ ] Expression articulations: bend, slide, hammer-on/pull-off, vibrato,
      harmonics, ties — engraver marks (bend arrows, slurs, vibrato wavy
      line) + input controls
- [ ] Notation-only view toggle (engine renders one staff per track)
- [ ] Export: MusicXML, MIDI, PDF (print stylesheet)
- [ ] Import: Guitar Pro (.gp3-7), MIDI, MusicXML — converters target the
      core model directly (no alphaTex bridge anymore)

### Phase 1c — Flagship UX (~4 wks, prototype FIRST within this phase)
- [ ] Direct note manipulation: drag pitch (vertical), drag duration edge (horizontal), snap
- [ ] Hum/sing/play correction input (monophonic pitch detection, WASM)
- [ ] Micro-interaction polish pass against "premium feel" checklist

### Phase 2 — Product base (~3 wks)
- [ ] Accounts + cloud sync (Clerk/Supabase), free/Pro tiers, Stripe
- [ ] Onboarding, sample songs, empty states
- [ ] Practice tools: loop section, tempo %, metronome, tuner
- [ ] Playback v2 groundwork: per-track mixer (Track model already has
      volume/pan/mute/solo), premium sample engine seam

### Phase 3 — AI features (~10-14 wks)
- [ ] **Chord-chart autopilot**: audio → chord lead sheet (first paywall)
- [ ] Audio → notation (Basic Pitch WASM client-side; GPU backend for Pro)
- [ ] Live session: MIDI input → mono audio → polyphonic
  - key/tempo constraints, chromatic/modal note flagging (never auto-correct intentional notes)
  - quantization controls (grid, swing, keep-as-played vs snap)
  - inline review/correction UI
  - latency calibration flow

### Phase 4 — Arranger + ecosystem (~6-8 wks)
- [ ] Setlist builder (song sequence, transposition, tempo per song)
- [ ] Integrated PDF/document viewer, annotations, footpedal page turns
- [ ] Auto-scroll/auto-page score tracking (mic-based position detection)
- [ ] Premium sound packs groundwork (per-instrument sample libraries)

### Phase 5 — Growth (ongoing)
- [ ] Piano + drum editors (piano roll for drums, velocity grid)
- [ ] Education layer, creator marketplace, licensed catalog
- [ ] Collaboration, version branching ("as played" vs "studio" takes)
- [ ] Desktop (Tauri) + iPad shells

## Monetization model (agreed)
- Freemium subscription ($8-12/mo, $60-90/yr) + lifetime tier
- Free: full editor, limited songs/storage, basic sounds, 2min live sessions
- Pro: unlimited AI transcription, premium sounds, PDF export, arranger, cloud sync
- Add-ons: sound packs, style packs; later marketplace (70/30), B2B education
- Caution: licensing for distributed user content; compute costs → client-side WASM inference where possible

## Solo-dev rules
- Ship something usable every 2 weeks (GP import alone gets Guitar Pro users trying it)
- Build in public (X / r/guitar) from first usable milestone
- Timebox hum-correction prototype to 2 weeks; pivot to drag-only if feel isn't there
- "Sounds real?" playback checklist tested every sprint (producer-ear QA)

## Engineering notes (current architecture decisions — see ADRs)
- Renderer: **in-house engraving engine** (ADR-003) — never reintroduce a
  third-party score renderer without revisiting the ADR.
- Own immutable score model + event-sourced commands; MusicXML compatibility
  via adapters (not MusicXML as internal format).
- Web-first (TS/React), desktop/iPad shells later (Tauri likely).
- Window-level keyboard handling; premium = consistency + motion +
  zero-latency feedback, enforced via design tokens (`packages/ui`).
- Monetization: freemium subscription; chord-chart autopilot = first AI
  paywall; client-side WASM inference preferred (cost + privacy).

## Final chapter — mobile adaptation (AFTER the web app works as intended)

> Do not start this before the web app is feature-complete and behaving the
> way we want. This phase is a dedicated pass to bring Sower to mobile
> phones. To-do list:

- [ ] Define the complete control mapping for mobile phone users — every
      desktop control needs a touch equivalent:
  - [ ] fret entry (on-screen keypad / number pad, two-digit frets)
  - [ ] note values + dots (duration palette, touch-sized targets)
  - [ ] rests (`B` shortcut → touch button / gesture)
  - [ ] articulations (palm mute, staccato, ghost, …)
  - [ ] tempo / time signature / note length (long-press menus already exist
        — tune the hit targets and popover sizing for thumbs)
  - [ ] caret navigation (arrows → on-screen D-pad or drag gestures)
  - [ ] undo/redo, measure insert/delete
  - [ ] playback transport + metronome (thumb-reachable)
- [ ] Touch gesture spec: tap = caret, long-press = context menu (done),
      double-tap = edit note, drag = scroll/zoom; disambiguate vs scrolling
- [ ] Mobile layout adaptation of the platform (responsive chrome: topbar,
      transport, status bar → bottom bars; safe areas; portrait + landscape)
- [ ] Score rendering on small screens (zoom/pinch, pan, readable fret sizes,
      horizontal vs vertical fit policy)
- [ ] Latency + audio on mobile browsers (autoplay policies, WebView quirks)
- [ ] On-device testing pass (iOS Safari + Android Chrome), then the
      mobile-specific UX polish checklist
