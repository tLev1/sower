# stdBd — Product Roadmap

> Working title: **stdBd** (name TBD — candidates: Adnoto, Selah, Jubal, Tabula)
> Solo developer. Web-first (TypeScript/React), packaged for desktop/iPad later.

## Locked requirements

- **Premium UX**: every interaction must feel smooth, snappy, deliberate. Design tokens, motion spec, 60fps score canvas. Direct manipulation (drag notes) + hum/sing correction are flagship interactions — prototype early.
- **High-quality playback sounds** (explicit user requirement): premium sampled instrument sets, articulation-aware triggering (strum offsets, palm mutes, round-robin drums), NOT stock soundfonts. Architecture must allow plugging sample engines into `SynthEngine`.
- **Latency (live input)**: AudioWorklet @ 128 samples, zero allocation in audio thread, note-on detection < 10ms, per-device calibration, two-stage display (instant echo → grid snap).
- **Clean architecture**: pure core, ports & adapters, event-sourced commands. Any subsystem replaceable without rippling.

## Phases

### Phase 0 — Foundation ✅ (started)
- [x] Monorepo (pnpm workspaces), TS strict, ESLint strictTypeChecked, CI
- [x] Core score model + event-sourced commands + tests
- [x] Renderer abstraction + alphaTab adapter
- [x] Audio adapter contracts (SynthEngine, LatencyProbe)
- [x] Design tokens package
- [x] Vertical slice: demo score → render (alphaTab)

### Phase 1a — Guitar tab editing (~8 wks)
- [ ] Score document store (autosave, IndexedDB persistence)
- [ ] Undo/redo history over command stream
- [ ] Guitar TAB editing: add/remove notes, fret input, string selection, bar management
- [ ] Playback v1 (alphaSynth via alphaTab; mixer per-track)
- [ ] Keyboard-first shortcuts (guitarist workflow: type frets 0-9, arrow keys navigate)

### Phase 1b — Notation + articulations (~4 wks)
- [ ] Standard notation view toggle (same data)
- [ ] Articulation editing (palm mute, bend, slide, hammer-on, vibrato, harmonics)
- [ ] Export: MusicXML, MIDI, PDF
- [ ] Import: Guitar Pro (.gp3-7), MIDI, MusicXML

### Phase 1c — Flagship UX (~4 wks, prototype FIRST within this phase)
- [ ] Direct note manipulation: drag pitch (vertical), drag duration edge (horizontal), snap
- [ ] Hum/sing/play correction input (monophonic pitch detection, WASM)
- [ ] Micro-interaction polish pass against "premium feel" checklist

### Phase 2 — Product base (~3 wks)
- [ ] Accounts + cloud sync (Clerk/Supabase), free/Pro tiers, Stripe
- [ ] Onboarding, sample songs, empty states
- [ ] Practice tools: loop section, tempo %, metronome, tuner

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
