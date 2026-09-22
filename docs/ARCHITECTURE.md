# stdBd — Architecture

## Principles

1. **Pure domain core.** `@stdbd/core` has zero dependencies — no React, no DOM, no audio, no I/O. Think "platform-independent layer" (embedded analogy: your HAL-free business logic).
2. **Ports & adapters.** Rendering, audio, AI are interfaces in adapter packages (`ScoreRenderer`, `SynthEngine`, `TranscriptionEngine`). Swapping alphaTab for another renderer, or soundfonts for premium samples, touches one adapter only.
3. **Event-sourced editing.** Every edit is a pure `Command` producing a new immutable `Score`. Undo/redo, version branching, diffs, and live-transcription review come free from this.
4. **Feature slices.** Features (editor, livesession, arranger) never import each other — only core + adapter interfaces. Enforced in CI.

## Dependency rule (CI-enforced)

```
apps/web ──> features ──> core + adapter interfaces
                │
                └──> adapters (render/audio/ai implementations)
core: depends on NOTHING
```

## Layout

```
apps/web          React app — composition, routing, providers only
packages/core     model/ commands/ operations/  (pure, fully unit-tested)
packages/render   ScoreRenderer interface + alphatab-adapter
packages/audio    SynthEngine, LatencyProbe contracts (implementations later)
packages/ui       design tokens (colors, motion, spacing) + components later
tooling/          shared eslint config
docs/             ROADMAP, this file, ADRs/
```

## Key decisions

| Decision | Choice | Why |
|---|---|---|
| Language | TypeScript strict | typed-language fit; ecosystem for notation/audio |
| Renderer | alphaTab (`@coderline/alphatab`) | tabs+notation+GP import+synth out of the box; behind adapter so swappable |
| Score format | own immutable model, MusicXML-compatible | full control; MusicXML import/export as adapters |
| Editing | event-sourced commands | undo/redo + versioning + live-session review for free |
| Timing | 480 ticks/quarter | standard resolution, matches MIDI |

## Latency architecture (live input)

- `AudioWorklet` @ 128-sample quantum (~2.7ms @ 48kHz), no allocations in callback
- Ring buffers between audio thread and detection worker
- Monophonic pitch detection incremental per-quantum (WASM, SIMD where available)
- Targets: note-on < 10ms, monitoring round-trip < 15ms
- **Per-device calibration**: user plays on prompt, app measures offset, adjusts timestamps
- UX: instant "echo" of detected pitch → visual snap-to-grid within ~150ms

## Conventions

- TypeScript strict + `noUncheckedIndexedAccess`; `any` is an ESLint error
- Imports within packages use `.js` extensions (Node-compatible ESM)
- Branded id types (`TrackId`, `BarId`, `NoteId`) prevent id mix-ups
- Tests in `packages/*/test/`, Vitest; E2E with Playwright when UI exists
- ADR in `docs/ADRs/` for genuinely debatable decisions only (solo-dev pragmatism)
