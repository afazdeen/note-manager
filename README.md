# Team Notes

A small team notes app that people and AI agents both use.

- **`api/`**: one Go server. REST at `/api` for the web app, MCP at `/mcp` for agents. Both call the same note service, so they always see the same notes.
- **`web/`**: React + TypeScript (Vite, TanStack Query, Tailwind). Its `<tag-input>` Web Component is used in the create dialog and the note view.

The detailed plan and design tokens are in [Implementation_Guide.md](Implementation_Guide.md).

## Run it

You need **Go 1.27+** and **Node 24+**. Start the API, then the web app, each in its own terminal:

```bash
cd api && go run ./cmd/server                 # http://localhost:8080 (seeds 5 demo notes)
cd web && npm install && npm run dev          # http://localhost:5173
```

The defaults work as they are. To change them, copy `.env.example` to `.env` in either folder.

| App | Variable | Default | Purpose |
|-----|----------|---------|---------|
| api | `HOST` | `127.0.0.1` | Address to listen on. There's no authentication, so by default only this machine can connect |
| api | `PORT` | `8080` | HTTP port |
| api | `CORS_ALLOWED_ORIGIN` | `http://localhost:5173` | The only browser origin allowed to call `/api` and `/mcp` |
| api | `SEED_NOTES` | `true` | Load demo notes on start |
| web | `VITE_API_BASE_URL` | `http://localhost:8080/api` | Where the web app finds the API |

The API refuses to start with an invalid value and lists every problem. Notes are kept in memory, so a restart resets them.

**Tests and checks** (the same ones CI runs on every push and PR):

```bash
cd api && gofmt -l . && go vet ./... && go test ./...
cd web && npm run typecheck && npm run lint && npm test -- --run && npm run build
```

## Run with Docker

You only need Docker (with Compose v2). To run the whole app:

```bash
docker compose up --build      # web: http://localhost:3000   API and MCP: http://localhost:8080
docker compose down            # stop and remove the containers
```

Ports are published on `127.0.0.1` only, because there's no authentication. To use other ports, set `WEB_PORT` and `API_PORT`, for example `WEB_PORT=4000 docker compose up --build`. The API's allowed origin and the web app's API URL follow automatically.

To build and run each image on its own:

```bash
# API: a static binary on distroless (~19 MB)
docker build -t team-notes-api ./api
docker run --rm -p 127.0.0.1:8080:8080 -e CORS_ALLOWED_ORIGIN=http://localhost:3000 team-notes-api

# Web: the built app on unprivileged nginx (~30 MB)
docker build -t team-notes-web --build-arg VITE_API_BASE_URL=http://localhost:8080/api ./web
docker run --rm -p 127.0.0.1:3000:8080 team-notes-web
```

The browser calls the API directly, so two settings have to match:
- `CORS_ALLOWED_ORIGIN` is the web app's URL.
- `VITE_API_BASE_URL` is the API's URL *as the browser sees it*. Vite builds it into the app, so it's a build argument, not something you can change with `docker run -e`.

Both Dockerfiles are multi-stage, so no compilers, Node or source code end up in the final images, and both run as non-root. Compose also makes the containers read-only and drops all Linux capabilities.

## Connect an agent (MCP)

With the API running, the MCP server is at `http://localhost:8080/mcp` (Streamable HTTP). It has three tools: `search_notes` (read-only), `create_note`, and `delete_note` (destructive).

```bash
claude mcp add --transport http team-notes http://localhost:8080/mcp
```

Then try this in Claude Code, with the web app open:

> Find my team's notes about planning, then create a note called "Release checklist" tagged release with three steps for Friday's release.

The new note appears in the web app within 15 seconds. To look at the tools directly, run `npx @modelcontextprotocol/inspector`, choose **Streamable HTTP**, enter the URL above, and keep **Via Proxy**. (Direct mode comes from the Inspector's own browser origin, which `/mcp` refuses on purpose.)

## Auth and destructive actions

**Now (local demo):**
- **No authentication.** Anyone who can reach the port can use the API and the tools.
- **Origin checks.** Browsers may only call the server from the web app's origin. On `/api`, CORS stops other sites reading responses; on `/mcp`, other sites get `403`. `POST` requests must be JSON, so a plain HTML form on another site can't create notes.
- **Tool hints.** MCP tools say whether they're read-only or destructive, so clients like Claude Code can ask you before running them.
- **Two-step delete.** `delete_note` refuses unless the agent passes `confirm: true`. Its error tells the agent to check with you first. The web app always asks for confirmation, and each delete is logged.

**In production** (more detail in [api/internal/mcp/note.md](api/internal/mcp/note.md)):
- **OAuth 2.1**, following the MCP authorization spec, through the team's identity provider. The server checks the token's signature, expiry and audience on every request.
- **Scopes:** `notes:read`, `notes:write` and `notes:delete`. Most agents would never get `notes:delete`.
- **Soft delete** with a 30-day trash, a `restore_note` tool and an Undo button, so a mistaken delete costs nothing.
- **An audit log** of who deleted what, from which client and when, plus rate limits on deletes. Where clients support it, the server would also ask the person to confirm (MCP elicitation) rather than trust a flag the model sets.

## Key decisions and trade-offs

- **Service/repository split.** `note.Service` owns the rules: validation, ids, timestamps and parsing the search text. `note.Repository` only stores, matches, orders and pages notes, the way SQL would. **Moving to SQLite means writing one new repository**; the service, REST, MCP and their tests stay the same. *Trade-off:* the in-memory version loses data on restart.
- **One server for REST and MCP.** People and agents can't drift apart: same notes, same validation, same errors. *Trade-off:* they scale together. That's fine at this size, and they could be split later because both only depend on the service.
- **Standard library first (Go).** `net/http` routing, `slog` and Go's cross-origin protection, plus the official MCP SDK. There's less to learn and maintain, at the cost of writing a little middleware by hand.
- **Stateless MCP with JSON responses.** It's simple, easy to test with curl and easy to scale. Since the 2026-07-28 MCP spec, the server can still ask the user mid-call (elicitation) without a session. *Trade-off:* only clients that support that spec can be asked this way; older ones would fall back to a confirmation the agent passes.
- **Optimistic UI.** Deletes show at once and roll back with an error toast if the server fails. Searches keep the previous results on screen while loading. Lists refetch every 15 s so agents' changes appear. *Trade-off:* this polls instead of pushing live updates.
- **Offset pagination and a virtual list.** The API returns pages (`offset`, `limit`, `total`) to REST and MCP alike. The web app loads 2 notes at a time as you scroll and only renders the rows near the view (TanStack Virtual), while keyboard navigation still covers the whole list. *Trade-off:* offsets shift when notes are added or deleted between page loads, so the app removes duplicates and its refetch re-aligns the pages; cursor pagination would avoid that. Each refetch also reloads every loaded page.
- **Native `<dialog>` and a framework-free Web Component.** The browser handles the modal focus trap. `<tag-input>` works in any framework and picks up the app's colour tokens through CSS variables. *Trade-off:* shadow DOM needed some extra care in tests.
- **Accessibility as a requirement, not polish.** Every action works from the keyboard and every control has a visible focus ring. Tap targets are at least 24px, and there's no sideways scrolling at 375px. The palette is locked to the design tokens.

## What I'd do with more time

1. Authentication and scopes, then soft delete with undo (as described above).
2. SQLite behind the repository interface.
3. Editing notes, with an `updatedAt` and a way to handle two people editing at once.
4. Live updates with server-sent events instead of polling.
5. Playwright end-to-end tests in CI. I checked keyboard-only use and 375px in a real browser with one-off scripts.
6. Cursor (keyset) pagination instead of offsets, Markdown in note bodies, dark mode, and testing with a real screen reader.

## How I used AI tools

I used **Claude Code** (in VS Code) as a pair programmer. I made the decisions; it planned, wrote code and tests, and ran the checks. I reviewed and committed each step before starting the next.

**Decisions I gave it up front**
- **Backend:** Go with the standard library, plus the official MCP SDK and godotenv. Notes in memory, with a few seeded notes so the demo isn't empty.
- **One server:** REST at `/api` and MCP at `/mcp`, sharing one note service.
- **Frontend:** React + TypeScript with Vite, TanStack Query and Tailwind. Tests with Vitest, Testing Library and MSW.
- **Web Component:** a `<tag-input>` tag picker, used in the create form and in the note detail.
- **Settings:** `.env.example` files for both apps, and CORS that only allows the web app.
- **Colours:** purple `#9d52e8` and green `#33ff94` as base colours (lighter or darker shades where needed). Red only for errors and delete.
- **Standards:** responsive, keyboard friendly, user-centred design.

**How I prompted it**
- **Plan first:** *"Before writing any code, create an Implementation_Guide.md … keep it simple … ask me for clarifications if required."*
- **Set rules:** a short [CLAUDE.md](CLAUDE.md). Follow the guide, ask before adding packages or changing a decision, use only the colour tokens, keep changes small, run all checks after each change, and never commit secrets.
- **One prompt per step**, each with clear acceptance criteria. For example: *"Scaffold both apps … then run all checks, start both apps, and show me a curl that proves CORS works for the web origin and not for others."*
- **Ask for proof, not just code:** curl output for every endpoint, tests for the error cases, and instructions for testing MCP with MCP Inspector and Claude Code.
- **Audit before finishing:** *"Go through the guide's requirements checklist and show me a table of what's met, partly met or missing, with evidence. Fix only the gaps."*

**AI proposals I changed or rejected**
- **Search parameter:** it used `q`; I renamed it to `search` in both REST and MCP.
- **Delete:** it planned delete only in the note view; I asked for a delete button on each list row too.
- **Search box:** it put it above the list; I moved it into the header.
- **Selected note:** it kept it in component state; I wanted it in the URL (`?note=id`) so links and the Back button work.
- **New note:** it planned a form in the right pane; I asked for a dialog instead.
- **Backend files:** it suggested a `notes` package with `model.go` and `repository.go`; I chose a `note` package split into `note.go`, `service.go` and `memory.go`.
- **Go module path:** it used `github.com/afazdeen/note-manager/api`; I changed it to `note-manager/api`.
- **Delete button colour:** I made the note view's Delete gray until hover, instead of always red.
- **Layout:** I asked for a wider list on large screens, a light-purple card for the open note, and more space between the title and the search bar.
- **New dependency:** it asked before adding `jsonschema-go` to fix MCP schema warnings, and I approved it.

**Changes I made myself**
- **Listen address:** the API now listens on `127.0.0.1` by default (new `HOST` setting). There's no authentication, so only this machine can connect unless you change it.
- **Validation:** titles can't contain control characters or text-direction characters, checked on both the server and the client.
- **Hardening:**
  - The web client now checks the shape of API responses instead of trusting them.
  - Repeated search words are only searched once.
  - The CORS origin setting is normalised (for example, a default port is dropped).
- **UX:**
  - Toasts pause while you hover or focus them.
  - A deleted note doesn't leave a dead entry in the browser history.
  - Tag chips read correctly with a screen reader.
  - The search box border is darker so it's easier to see.
- **Docker:** I dockerized both apps with multi-stage builds and added one Compose file.
  - Setup is a single command (`docker compose up --build`), with no local Go or Node needed.
  - The final images hold only what runs the app, so they're small: about 19 MB for the API and 30 MB for the web app.

**What I checked myself**
- **Every step:** I reviewed the summary and the changes, then committed before moving on.
- **The browser:** I tried the features myself. I found *"Save note is not working … `el.commitPending is not a function`"*, reported it, and it traced the cause to a stale Web Component left by hot reload, then fixed that.
