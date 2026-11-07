# Team Notes

A notes app for people (React UI in `web/`) and AI agents (MCP). Both use one Go server in `api/`.

## Source of truth
- Follow `Implementation_Guide.md`. Ask before doing anything it doesn't cover or that goes against it.
- When we change a decision, update the guide in the same change.

## Code
- Use standard, idiomatic Go and React suited to a small project. Don't add layers or abstractions we don't need.
- Go dependencies: standard library, the official MCP Go SDK and godotenv only. Ask before adding any package, Go or npm.
- REST and MCP both call `note.Service`. Validation and rules live in the service; the repository stores, matches and orders notes.
- TypeScript is in strict mode: no `any`, no `@ts-ignore`.

## UI
- Every view that loads data has a skeleton, an empty state and an error state with a retry.
- Every input has a label. Everything works with the keyboard and has a visible focus ring.
- Layouts work at 375px wide with no horizontal scroll.
- Only use the colour tokens from the guide (section 9). Don't add new colours or hex values.

## Workflow
- Keep each change small and reviewable, following the build order in the guide.
- After each change, run the checks and fix any failures before moving on:
  - `api/`: `gofmt -l .`, `go vet ./...`, `go test ./...`
  - `web/`: `npm run typecheck`, `npm run lint`, `npm test -- --run`, `npm run build`
- End each change with a short summary: what changed, the check results, and any open questions.
- Never commit secrets or `.env` files. Commit only the `.env.example` files.
