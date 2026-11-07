# Team Notes

A small team notes app that people and AI agents can both use:

- **`api/`**: a Go server. The REST API is under `/api`, and the MCP server will be at `/mcp`. Notes are kept in memory.
- **`web/`**: React + TypeScript (Vite), TanStack Query, Tailwind, and a `<tag-input>` Web Component.

The plan, decisions and design tokens are in [Implementation_Guide.md](Implementation_Guide.md).

> **Status:** scaffold only. The API serves `/api/health` with CORS, and the web app shows the app shell. Note features come next.

## Prerequisites

- Go 1.27+ (see `api/go.mod`)
- Node.js 24+ and npm

## Setup

### API

```bash
cd api
cp .env.example .env      # optional: the defaults work for local development
go run ./cmd/server       # http://localhost:8080
curl http://localhost:8080/api/health   # {"status":"ok"}
```

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `8080` | HTTP port |
| `CORS_ALLOWED_ORIGIN` | `http://localhost:5173` | The only browser origin allowed to call `/api` |
| `SEED_NOTES` | `true` | Load demo notes on start |

The server refuses to start if a value is invalid, and lists every problem. Press `Ctrl+C` to shut it down gracefully.

### Web

```bash
cd web
cp .env.example .env      # optional: defaults to http://localhost:8080/api
npm install
npm run dev               # http://localhost:5173
```

| Variable | Default | Purpose |
|----------|---------|---------|
| `VITE_API_BASE_URL` | `http://localhost:8080/api` | API base URL, read only in `src/config/env.ts` |

The dev server always uses port 5173 so that it matches `CORS_ALLOWED_ORIGIN`.

## Checks

These are the same checks that CI runs (`.github/workflows/`). Each app's workflow runs on every push and pull request that changes its files.

```bash
# api/
gofmt -l .          # should print nothing
go vet ./...
go test ./...

# web/
npm run typecheck
npm run lint
npm test -- --run
npm run build
```

## Still to come

The sections the brief asks for, which I'll fill in as the build progresses: key decisions, what I'd do with more time, and how I used AI tools.
