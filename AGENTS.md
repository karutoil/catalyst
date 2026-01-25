# Repository Guidelines

This repository hosts the Aero platform: a TypeScript backend, a Rust agent, and a
React frontend, plus shared types and end-to-end tests.

## Project Structure & Module Organization
- `aero-backend/`: TypeScript backend (`src/`, `prisma/`, Prisma schema in
  `prisma/schema.prisma`).
- `aero-frontend/`: React app (`src/components`, `src/pages`, `src/hooks`,
  `src/services`, `src/styles`).
- `aero-agent/`: Rust daemon (`src/`, `config.toml`, `config-e2e.toml`).
- `aero-shared/`: Shared TypeScript types.
- `tests/`: Bash E2E suites (`NN-name.test.sh`) with helpers in `tests/lib/`.
- `templates/`: Server template JSON files.
- Root scripts: `docker-compose.yml`, `test-*.sh`, `verify-build.sh`, `scripts/`.

## Build, Test, and Development Commands
- `docker-compose up -d`: start Postgres + Redis for local dev.
- Backend: `cd aero-backend && npm install && npm run dev` (watch mode),
  `npm run build`, `npm run start`.
- Backend DB: `npm run db:push`, `npm run db:seed`, `npm run db:migrate`,
  `npm run db:studio`.
- Frontend: `cd aero-frontend && npm install && npm run dev`, `npm run build`,
  `npm run preview`.
- Agent: `cd aero-agent && ./setup-dev.sh` or `cargo build --release`.
- Quick API/E2E checks: `./test-backend.sh`, `./test-api-integration.sh`,
  `./test-e2e-simple.sh`, `./test-e2e.sh`, `./test-e2e-complete.sh`.
- Full E2E suite: `cd tests && ./run-all-tests.sh`.

## Coding Style & Naming Conventions
- TypeScript/TSX linting via `npm run lint` in backend and frontend.
- Frontend formatting via Prettier (`aero-frontend/.prettierrc`: single quotes,
  trailing commas, 100-column print width).
- Naming: React components/pages use `PascalCase` and `*Page.tsx`; hooks use `useX`
  in `src/hooks`; shell tests use `NN-name.test.sh`.

## Testing Guidelines
- Primary integration coverage is in `tests/` Bash suites; configure targets in
  `tests/config.env`.
- Frontend unit tests: `npm run test` (Vitest). Frontend E2E: `npm run test:e2e`
  (Playwright).
- Backend smoke tests: `./test-backend.sh` and `./test-api-integration.sh`.

## Commit & Pull Request Guidelines
- Git history mixes conventional commits (e.g., `feat: ...`) and imperative
  summaries (e.g., `Add ...`); prefer a short, imperative subject, and use
  `feat:`/`fix:` when possible.
- PRs should include: a clear summary, tests run, linked issues, and screenshots
  for UI changes.
- Keep changes scoped to the relevant module (`aero-backend`, `aero-frontend`,
  `aero-agent`).

## Configuration & Security Tips
- Use `.env` files in `aero-backend/` and `aero-frontend/`
  (`.env.example` templates provided).
- Agent configuration lives in `aero-agent/config.toml` (and `config-e2e.toml`
  for tests); avoid committing secrets.
