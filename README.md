# stdBd

Premium music score & tab creation platform. Tabs + notation for guitar, bass,
piano, drums — with AI transcription (audio→score, live input) and a live
setlist arranger.

See [docs/ROADMAP.md](docs/ROADMAP.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Development

```bash
pnpm install
pnpm dev          # web app (Vite)
pnpm test         # all unit tests
pnpm typecheck    # all packages
pnpm lint         # all packages
```

## Layout

- `apps/web` — web application
- `packages/core` — pure score domain (no dependencies)
- `packages/render` — score rendering adapters (alphaTab)
- `packages/audio` — synth engine contracts
- `packages/ui` — design tokens + UI components
- `docs/` — roadmap, architecture, ADRs
