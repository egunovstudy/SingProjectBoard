# Repository Guidelines

## Project Structure & Module Organization

Start with [project context](docs/PROJECT_CONTEXT.md), then read `codex-singularity-board-prompt.md` and `README.md`. Keep the context current when behavior or architecture changes. This local, single-user monolith uses: Java 21 / Spring Boot, PostgreSQL / Liquibase, React / TypeScript / Vite / React Flow.

Backend: `src/main/java/ru/singboard/`: `BoardService` owns synchronization and durable operations, `Store` handles persistence, and `SingularityGateway` has separate real and demo adapters. Resources and versioned migrations live in `src/main/resources/`. Tests: `src/test/java/ru/singboard/`. Frontend: `frontend/src/`; `boardModel.ts` resolves recurring series; `matrixGeometry.ts` handles expansion and quadrant placement around fixed axes. Browser regressions: `frontend/tests/board.spec.ts` and `usability.spec.ts`. Helpers: `scripts/`; notes: `docs/`.

## Build, Test, and Development Commands

- `./scripts/build.sh`: install locked frontend dependencies, build assets, and run Maven verification; outputs an executable JAR containing the UI.
- `./mvnw verify`: compile and test backend, including fake HTTP-server tests. Rebuild frontend first when packaging UI changes.
- `cd frontend && yarn install --frozen-lockfile && yarn build`: check TypeScript and build production assets.
- `cd frontend && yarn dev`: start Vite on port 5173; proxy API calls to port 8080.
- `docker compose -f compose.yaml -f compose.dev.yaml up -d db`: expose development PostgreSQL on `127.0.0.1:15432`.
- `DB_URL=jdbc:postgresql://127.0.0.1:15432/singboard ./mvnw spring-boot:run`: run backend against that development database.
- `APP_MODE=demo docker compose up --build -d`: start the full demo with persistent PostgreSQL.
- `APP_MODE=demo ./scripts/run-local.sh`: run the built JAR with durable local H2.
- `cd frontend && yarn test:unit`: run UI data-handling tests.
- `cd frontend && yarn test`: run Playwright scenarios with an isolated demo backend on port 18080.

## Coding Style & Naming Conventions

Use four-space Java indentation, PascalCase classes/components, and camelCase methods/variables. Frontend formatting is controlled by Prettier: `yarn format` / `yarn format:check`; use `yarn typecheck` for static checks. Keep user-facing text Russian and pin dependency versions. Never edit an applied Liquibase changeset; add a new one.

## Testing Guidelines

Use JUnit 5 / AssertJ and Playwright. Name Java tests `*Test.java` and browser tests `*.spec.ts`. No coverage percentage is imposed. Prioritize data preservation, tag intent, ID mappings, pagination, conflicts, ambiguous creation, and persistence. Tests must never contact a real account. TCP tests are tagged `network`; `./mvnw verify -DexcludedGroups=network` is a limited check for restricted environments.

## Commit, PR & Security Guidelines

No usable Git history exists; use concise imperative subjects. PRs should describe behavior, relevant requirements, verification results, and UI screenshots. Distinguish demo from real-account validation.

Keep `.env` and tokens out of Git, images, browser code, and logs. Bind published ports to `127.0.0.1`. Default Compose exposes only the app; database host access requires `compose.dev.yaml`. Preserve database volumes and queued operations. Verify official API schemas before adapter changes; never silently fall back from real to demo.
