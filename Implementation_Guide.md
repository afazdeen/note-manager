# Implementation Guide: Team Notes

A small notes app that people (React UI) and AI agents (MCP) both use. One Go server holds the notes in memory. REST and MCP call the same service, so both see the same data. The time budget is about 3 hours.

## 1. Requirements checklist

| #  | Requirement | Delivered by |
|----|-------------|--------------|
| R1 | Backend API: create, list, search, delete. Notes in memory. A few meaningful tests | `api/`: Go standard library, `note` package (note / service / memory repository), `httptest` tests |
| R2 | React + TypeScript UI: list and detail views, loading/empty/error states, keyboard friendly | `web/`: Vite, TanStack Query, Tailwind |
| R3 | One Web Component used inside React | `<tag-input>` tag picker, used in the create form and in the note detail |
| R4 | MCP server with at least 2 tools, plus a note on auth and destructive actions | `/mcp` on the same server: `search_notes`, `create_note`, `delete_note`, plus `api/internal/mcp/note.md` |
| R5 | README: setup, decisions, next steps, AI usage | `README.md` at the root: setup, using MCP, checks, key decisions, what I'd do with more time, how I used AI tools |

## 2. Architecture

```
 Browser (React app, :5173)               AI agent (MCP client)
        │  fetch JSON (CORS: web origin only)      │  Streamable HTTP
        ▼                                          ▼
 ┌──────────────────── Go server (:8080) ─────────────────────┐
 │  /api/*  httpapi handlers          /mcp  mcp tool handlers │
 │              └──────────┬───────────────┘                  │
 │                   note.Service  (validation, id, time)     │
 │                         │                                  │
 │                   note.Repository (in memory, RWMutex)     │
 └────────────────────────────────────────────────────────────┘
```

- The service validates and normalises input, sets `id` and `createdAt`, and turns the search text into lowercase terms. The repository interface is defined in `service.go` (`Create`, `Get`, `Search(terms)`, `Delete`). The repository does the matching and the newest-first ordering, the way SQL would, so a SQLite repository could replace the in-memory one without other changes. The in-memory repository copies notes on the way in and out, so callers can't change stored data.
- On start, the server seeds 5 notes with different tags and timestamps (can be switched off with `SEED_NOTES=false`).
- Agents can change notes too. The UI refetches when the window regains focus and every 15 s, so those changes show up.

## 3. Note model and rules

```go
type Note struct {
    ID        string    `json:"id"`        // 16 random bytes from crypto/rand, hex encoded
    Title     string    `json:"title"`
    Body      string    `json:"body"`
    Tags      []string  `json:"tags"`      // always an array, never null
    CreatedAt time.Time `json:"createdAt"` // UTC, RFC 3339
}
```
Notes can't be edited, so there is no `updatedAt`.

**Validation** (the service trims and normalises the input first, then validates it):

| Field | Rule |
|-------|------|
| title | Required after trimming. 1–120 characters. A single line: no control characters (line breaks, tabs) and no bidirectional controls such as U+202E |
| body  | Optional. At most 10,000 characters. Plain text |
| tags  | 0–10 tags. Each one is trimmed, lowercased and de-duplicated, then must match `^[a-z0-9][a-z0-9-]{0,23}$` (1–24 characters: letters, digits, hyphens, not starting with a hyphen) |

All failing fields are returned together, one message per field.

**Search**: the `search` text (the same parameter name in REST and MCP) is trimmed, split on whitespace and de-duplicated. A note matches when *every* term appears, case-insensitively, in the title, the body or any tag. An empty or missing `search` returns all notes. Results are always newest first (`createdAt` descending, ties broken by `id`).

## 4. REST API (`/api`)

| Method & path | Success | Errors |
|---------------|---------|--------|
| `GET /api/notes?search=<text>` | `200 {"notes": Note[]}` | – |
| `GET /api/notes/{id}` | `200 Note` | 404 |
| `POST /api/notes` body `{title, body?, tags?}` | `201 Note` + `Location` | 400, 413, 415, 422 |
| `DELETE /api/notes/{id}` | `204` | 404 |
| `GET /api/health` | `200 {"status":"ok"}` | – |

Every error uses one shape (`fields` appears only for 422):
```json
{ "error": { "code": "validation_failed", "message": "Some fields are invalid.",
             "fields": { "title": "is required", "tags": "\"bad tag!\" is not a valid tag (...)" } } }
```
Codes:
- `bad_request` (400): malformed JSON, unknown fields, wrong types, an empty body, or more than one object.
- `not_found` (404): unknown note ids and unknown routes, including routes outside `/api`.
- `method_not_allowed` (405): a known path with the wrong method, plus an `Allow` header.
- `payload_too_large` (413): a body over 64 KB.
- `unsupported_media_type` (415): `POST` without `Content-Type: application/json`. This forces browsers to send a preflight, so another site can't create notes with a plain form post.
- `validation_failed` (422).
- `internal` (500): a generic message. The real cause is only logged. Panics are recovered, logged with a stack trace, and answered with this error.

Routing uses Go 1.22+ `http.ServeMux` method patterns. Handlers depend on a small `NoteService` interface, and every request is logged with its method, path, status and duration.

## 5. MCP server (`/mcp`)

The server uses the official Go SDK (`github.com/modelcontextprotocol/go-sdk` v1.8.0) and is mounted at `/mcp` on the same mux, calling the same `note.Service` as REST.
- **Transport:** Streamable HTTP, **stateless**, with plain JSON responses. Each request stands alone, because the tools need no session and no messages from the server. The cost is that server-to-client features such as elicitation aren't available; see `note.md`.
- **Schemas:** inputs and outputs are typed Go structs with `jsonschema` descriptions on every field. The schemas are generated from them with `github.com/google/jsonschema-go`, the SDK's own schema library, used directly. Lists are then rewritten from `["null","array"]` to plain `"array"`, so clients that only accept one type per field can use the tools. A test fails if a multi-type field comes back.
- **Server instructions:** the server tells agents what the notebook is and when deleting is allowed.

| Tool | Input | Output | Annotations |
|------|-------|--------|-------------|
| `search_notes` | `search?` string (empty = most recent), `limit?` int (1–50, default 10) | `{notes, total}` | `readOnlyHint: true` |
| `create_note` | `title`, `body?`, `tags?` | created note | `readOnlyHint: false`, `destructiveHint: false` |
| `delete_note` | `id`, `confirm` bool | `{deleted: id, title}` | `destructiveHint: true`, `idempotentHint: true` |

All three tools are `openWorldHint: false`. Errors come back as tool errors (`isError: true`) the agent can read and act on:
- **Validation:** the same field messages as REST.
- **Unknown id:** suggests running `search_notes`.
- **Missing `confirm`:** tells the agent to check with the user first.
- **Bad `limit`:** the input schema gives `limit` a `minimum` of 1, a `maximum` of 50 and a `default` of 10. The SDK applies the default and rejects other values before the tool runs, with an error naming the bound.
- **Unexpected errors:** logged, and a generic message is returned.

**`api/internal/mcp/note.md`** covers authentication (OAuth 2.1 following the MCP auth spec, with `notes:read` / `notes:write` / `notes:delete` scopes) and safer deletes (soft delete with undo, elicitation, rate limits, audit log).

## 6. Environment and CORS

| File | Variable | Default | Purpose |
|------|----------|---------|---------|
| `api/.env.example` | `HOST` | `127.0.0.1` | Address to listen on: an IP address or `localhost`. There's no authentication, so by default only this machine can connect |
| | `PORT` | `8080` | HTTP port |
| | `CORS_ALLOWED_ORIGIN` | `http://localhost:5173` | The only origin allowed to call `/api` from a browser |
| | `SEED_NOTES` | `true` | Load the demo notes on start |
| `web/.env.example` | `VITE_API_BASE_URL` | `http://localhost:8080/api` | API base URL |

`godotenv.Load()` reads `api/.env` if it exists, and real environment variables take priority. The CORS middleware wraps `/api` only. When `Origin` exactly matches the allowed origin, it sets `Access-Control-Allow-Origin` (plus `Vary: Origin`), allows `GET, POST, DELETE` and the `Content-Type` header, and answers preflight requests with 204. Other origins get no CORS headers, so the browser blocks them. Their preflights, and preflights for any other method, are refused with 403. The origin is stored the way browsers send it: lowercase and without a default port (`:80` for http, `:443` for https). Invalid env values (such as a host name in `HOST`, a bad port, a wildcard or a path in the origin, or a non-boolean seed flag) stop the server at startup with every problem listed. `/mcp` sends no CORS headers, because MCP clients are not browser pages. It is wrapped in Go's `http.CrossOriginProtection`, which trusts only `CORS_ALLOWED_ORIGIN`. Browser requests from any other origin get `403 {"error":{"code":"forbidden",…}}`. Agents send no `Origin` header and are allowed. The SDK also blocks DNS rebinding on localhost.

## 7. UI

**Layout.** The header holds the app name, the search box and a **New note** button, above a purple→green gradient bar. There's a wide gap between the app name and the search box: 40 px from 768 px up. Below 768 px, the search box wraps onto its own full-width line, 16 px below the name. At 768 px and wider there are two panes under the header: the note list on the left (360 px, widening to 416 px from 1024 px, with a shortcuts hint at the bottom) and the detail view on the right. Below 768 px there is one pane at a time: the list, then the detail with a **Back** button.
- **Selected note:** stored in the URL as `?note=<id>` with `history.pushState` and no router. Links work, and the browser's Back button returns to the list. When the open note is deleted, the next note replaces it in the history (`replaceState`), so Back never leads to the deleted note.
- **Mobile focus:** opening a note moves focus to the detail pane, and Back returns focus to that note's row. Clicking a tag in the note goes back to the list and focuses the search box.

Each list row shows the title, a 2-line body preview, tag chips, a relative date ("3 h ago") and a delete icon button. Screen readers hear the title as the row's name, then the date and tags. The button is labelled "Delete note <title>" and turns red on hover or focus. It sits beside the row's button, not inside it, because buttons can't nest. The list is one Tab stop (the last-focused row, then the selected row, then the first), followed by that row's delete button. The detail view shows the open note in a card with rounded corners (`purple-50` background, `purple-100` border). Its loading skeleton uses the same card shape. The card holds the title, the full date, the body (whitespace kept), a read-only `<tag-input>` (clicking a tag searches for it) and a **Delete** button. The button is gray and only turns red on hover or keyboard focus.

**Create dialog.** **New note**, the `n` key, or **Create your first note** (in the empty state) opens a native `<dialog>` with `showModal()`. The browser makes the page behind it inert and keeps Tab inside, so no focus-trap code is needed. It holds a title, a body textarea and an editable `<tag-input>`.
- **Focus:** goes to the title when the dialog opens, and back to **New note** when it closes.
- **Keys:** Enter in the title moves to the body. Ctrl/⌘+Enter saves. Esc cancels, except while saving.
- **Validation:** the same rules as the server (`src/lib/validateNote.ts`). The first invalid field gets focus.
- **Unfinished tag:** on save, a typed but un-added tag is committed with `commitPending()`. If it's invalid, saving stops.
- **Server errors:** 422 field messages appear under the matching fields. Other errors appear at the top of the form, and the input is kept.
- **After saving:** the dialog closes, the new note is selected and a "Note created" toast shows.

**States**

| Area | Loading | Empty | Error |
|------|---------|-------|-------|
| List | 4 skeleton rows; `aria-busy` | No notes: "No notes yet" + **Create your first note**. No matches: "No notes match "x"" + **Clear search** | Inline red banner + **Retry** |
| Detail | Skeleton block | Nothing selected: "Select a note" | 404: "Note not found" (it may have been deleted, for example by an agent) + **Back to notes**. Other errors: banner + **Retry** |
| Create | Save button disabled and reads "Saving…". Cancel and Esc are disabled too | – | Field errors under each input (client-side and from a 422). Other errors: alert at the top of the form; input is kept |
| Delete | None: the note leaves the list at once (optimistic), and if it was open the next note is selected | – | The note comes back (and is re-selected if you haven't moved on), plus an error toast. A 404 isn't an error: the note was already gone (for example, an agent deleted it), so it counts as deleted |

Successful create or delete shows a toast (an `aria-live="polite"` region). After a create, the new note is selected. After a delete, the row is removed from the list right away and restored if the request fails. If the deleted note was open, the next note is selected. Search is debounced by 250 ms and the previous results stay on screen while new ones load.

**Data layer** (`src/api/`):
- **Errors:** every failed call rejects with one `ApiError` (`status`, `code`, `message`, `fields`). TanStack Query is told about it, so `error` is typed everywhere. When there's no usable API response, the client adds `network_error` (status 0) or `invalid_response`.
- **Response checks:** responses are checked, not cast. A note, a list or an error body in the wrong shape becomes `invalid_response`. An error code the app doesn't know also becomes `invalid_response`, keeping the server's message, and field messages that aren't strings are dropped.
- **Retries:** queries retry once on network and 5xx errors, and never on 4xx.
- **Search:** search text is trimmed, its whitespace collapsed and lowercased before it's used as the query key. Lists and the open note refetch every 15 s.
- **Create:** refetches all lists (without waiting, so the dialog closes at once), so the new note shows up in the right place for every search.
- **Delete:** the mutation has a key, and lists leave out every note whose delete is still running. So the note disappears at once, a refetch during the delete (the 15 s interval, window focus, or another delete) can't bring it back, and if the request fails it simply reappears, with an error toast. On success it is removed from every cached list.

**Toasts:** no library. Success toasts last 4 s and errors 8 s. The timer pauses while the pointer is over a toast or focus is inside it. At most 3 show at once, and each has a dismiss button. Success uses `role="status"` and errors `role="alert"`.

**Keyboard** (single-key shortcuts don't fire while typing in a field)

| Key | Action |
|-----|--------|
| `/` | Focus search |
| `n` | New note |
| `↑` / `↓` | Move through the list (focus moves between rows) |
| `Enter` | Open the focused note |
| `Delete` (or `Backspace`, labelled "delete" on Mac) | Delete the note of the focused list row (its row or its delete button), otherwise the open note (opens the confirm dialog) |
| `Ctrl/⌘ + Enter` | Submit the create form |
| `Esc` | Close the dialog, cancel the form, or clear the search |

**Delete confirmation:**
- **The dialog:** an `alertdialog` on the native `<dialog>`, so the page behind is inert. It starts on **Cancel**, so Enter can't delete by accident.
- **Wording:** "Delete this note?", naming the note and saying that agents lose it too.
- **Focus:** Cancel and Esc return focus to whatever opened the dialog. After a delete, focus moves to the newly selected note's row, or to the detail pane on mobile. With no notes left, it moves to **New note**.

**Shortcuts and focus:**
- **Shortcuts:** page shortcuts are off while any dialog is open.
- **Focus rings:** every control has a visible focus ring. `<main>` and the detail pane don't, because focus only reaches them through the skip link or opening a note on mobile.
- **Motion:** the app respects `prefers-reduced-motion`.
- **Hint:** a shortcuts hint (N, /, ↑↓, Enter, Del) sits at the bottom of the list pane on desktop.
- **Tap targets:** at 375 px every control is at least 24 px, and nothing scrolls sideways.

## 8. Web Component: `<tag-input>`

This is a framework-free custom element written in TypeScript with a Shadow DOM. Importing `tag-input.ts` registers it, guarded so it only registers once. The React wrapper imports it.

| API | Details |
|-----|---------|
| Attributes | `value` (comma-separated initial tags), `placeholder`, `max-tags` (default 10), `readonly`, `disabled`, `label` (accessible name), `error` (a message from the form, e.g. a 422 for tags: shown under the field after the element's own message, linked to the input with `aria-describedby` and announced) |
| Property | `tags: string[]` (get/set) |
| Events | `tags-change` → `detail: {tags}`, and `tag-click` → `detail: {tag}` (readonly mode). Both bubble and are composed |
| Keys | `Enter` or `,` adds a tag. `Backspace` on an empty input removes the last tag. Pasting `a, b, c` adds several. Each chip has a × button labelled "Remove tag x" |
| Method | `commitPending()` adds any typed but un-added text as tags, and returns `false` if some of it was rejected. Forms call it on submit |
| Rules | The same normalisation and regex as the backend (`tag-rules.ts`, which the create form will reuse). An invalid tag, a duplicate or one over the limit is not added. It stays in the input, which gets a red border and `aria-invalid`, with an explanation linked by `aria-describedby` |
| Readonly | No input and no remove buttons. Chips become buttons that fire `tag-click`. The note detail uses this mode, and clicking a tag searches for it |
| Styling | CSS custom properties `--tag-bg`, `--tag-fg`, `--tag-focus`, plus `::part(label)`, `::part(field)`, `::part(chip)` and `::part(input)`. The defaults read the app's `--color-*` tokens. CSS variables pass into the shadow DOM, and `@theme static` makes Tailwind emit every token |
| Safety | User text is always set with `textContent`, never `innerHTML` |

A small `TagInput.tsx` wrapper sets the `tags` property and listens for events with a `ref`. A JSX type declaration (`tag-input-jsx.d.ts`) makes `<tag-input>` type-safe. Global shortcuts use `event.composedPath()`, so typing inside the shadow input doesn't trigger them.

## 9. Design tokens

The tokens are defined once in Tailwind v4 `@theme` (`web/src/index.css`). Tailwind's default palette is removed, so only these colours exist. Text contrast meets WCAG AA (at least 4.5:1).

| Token | Hex | Used for |
|-------|-----|----------|
| `bg` / `white` | `#ffffff` | Page background / text on filled purple and red buttons (same value) |
| `surface` | `#faf8fd` | List pane background |
| `border` | `#e7e2f0` | Dividers (1.3:1, too light for the edge of an input) |
| `ink` / `ink-muted` | `#1d1630` / `#5e5873` | Main text / secondary text, dates and input borders (6.7:1, above the 3:1 an input's edge needs) |
| `purple-50` | `#f6effe` | Hover, the selected list row, and the open-note card background |
| `purple-100` | `#ead9fc` | Tag chip background and the open-note card border |
| `purple-500` | `#9d52e8` | **Base**: focus ring, selected-row edge, gradient start |
| `purple-600` | `#8636d6` | Primary button background (white text, ~6:1) |
| `purple-700` | `#6c25b3` | Primary hover, links, tag chip text |
| `green-50` | `#ebfff4` | Success toast background |
| `green-400` | `#33ff94` | **Base**: gradient end only (never text) |
| `green-700` | `#0a7a40` | Success text and icons (~5.4:1) |
| `red-50` / `red-600` / `red-700` | `#fef2f2` / `#dc2626` / `#b91c1c` | Error banner and Delete-hover background / error text, borders and the confirm dialog's **Delete note** button / Delete hover text and Retry text |
| `gradient-brand` | `linear-gradient(90deg, #9d52e8, #33ff94)` | Header bar and the empty-state illustration accent (utility: `bg-gradient-brand`) |

## 10. Folder layout

```
api/
  cmd/server/main.go              config, seed data, mux wiring (routes), graceful shutdown  main_test.go
  internal/config/config.go
  internal/note/                  note.go (type, validation)  service.go (+ Repository interface)  memory.go  seed.go  *_test.go
  internal/httpapi/               handlers.go  errors.go  json.go  cors.go  logging.go  recover.go  *_test.go
  internal/mcp/                   server.go  tools.go  schema.go (portable schemas)  tools_test.go  note.md
  go.mod  .env.example  Dockerfile (Go build → distroless, ~19 MB)  .dockerignore
web/
  src/config/env.ts               the only reader of import.meta.env (typed, validated)
  src/lib/                        queryClient.ts  format.ts (relative and full dates)  validateNote.ts (same rules as the API)
  src/api/                        client.ts  notes.ts (query hooks)  types.ts
  src/components/                 NoteList  NoteDetail  CreateNoteForm (CreateNoteDialog)  Dialog (native <dialog>)  SearchBar  ConfirmDialog  EmptyState  ErrorState  Skeleton  TagChips  icons  buttonStyles.ts
  src/components/toast/           ToastProvider.tsx  toast-context.ts (useToast)
  src/web-components/tag-input/   tag-input.ts  tag-rules.ts  TagInput.tsx  tag-input-jsx.d.ts  *.test.ts(x)
  src/hooks/                      useShortcuts  useNoteParam (?note=)  useDebouncedValue  useMediaQuery
  src/test/                       MSW handlers + in-memory db, server, setup, render helpers, viewport (matchMedia stub)
  App.tsx  main.tsx  index.css    App.test.tsx  CreateNote.test.tsx  DeleteNote.test.tsx (app-level flows)
  .env.example  package.json  vite.config.ts  eslint.config.js
  Dockerfile (Node build → unprivileged nginx alpine-slim, ~30 MB)  nginx.conf  .dockerignore
.github/workflows/                api.yml  web.yml (lint, test, build when that app's files change, on push and PR)
compose.yaml                      api + web; ports on 127.0.0.1 (WEB_PORT 3000, API_PORT 8080); read-only, no capabilities
README.md  Implementation_Guide.md  CLAUDE.md  .gitignore
```

## 11. Test plan

- **Go service**: a table test for validation (missing title, too long, bad tag, tag lowercasing and de-duplication). Search tests for case-insensitivity across title, body and tags, multi-term AND matching, and newest-first order. Delete of an unknown id returns not found.
- **Go HTTP** (`httptest`): POST 201 and 422 with the error shape, GET with `search`, DELETE 204 and 404, CORS preflight from the allowed origin vs another origin.
- **Go MCP** (in-memory transport and SDK client): `create_note` then `search_notes` finds the note. `delete_note` without `confirm` is refused.
- **Go wiring** (`cmd/server`, real loopback listener): `/api` has CORS and `/mcp` doesn't, `/mcp` refuses other sites and DNS rebinding, unknown routes get the JSON 404, and every request is logged.
- **Web** (Vitest, Testing Library, MSW): list loading, empty, error and retry. The create flow, including a server 422 (tags errors linked to the tag input). Deleting from a list row through the confirm dialog, the `Delete` and `Backspace` keys, a 404 counting as deleted, and the history after a delete. Delete cache cases: a refetch during a pending delete, and one failing delete next to a successful one. API response checks. Toast pausing. `<tag-input>` add, normalise, Backspace removal, events and the `error` attribute. The `/` and `n` shortcuts. Phone-width behaviour (focus on open, Back, tag click, delete) with a `matchMedia` stub (`src/test/viewport.ts`), since jsdom has none.

## 12. Build order (~3 h)

1. `note` package (note, service, memory repository, seed) + tests (35 min)
2. REST handlers, errors, CORS, config, `main.go` + tests (30 min)
3. MCP tools + test, then write `note.md` (25 min)
4. Web scaffold, tokens, API client, query hooks, MSW (20 min)
5. List, search and detail with all states (30 min)
6. `<tag-input>`, create form, delete flow (25 min)
7. Keyboard shortcuts, responsive layout, accessibility pass, web tests (20 min)
8. README (15 min)

## 13. Out of scope

Editing notes, users and authentication (described in `note.md` only), SQLite and other persistence, pagination, Markdown rendering, live push updates (the UI polls instead), a client-side router (only `?note=` is in the URL), dark mode, deployment (Docker images and Compose are for running locally; there's no registry, TLS or hosting setup), i18n.

## 14. Assumptions

- There is one shared notebook with no users. Notes are plain text.
- React 19, Tailwind v4, Go 1.22+ (1.27 installed). The selected note is kept in the URL (`?note=<id>`); the search text is not.
- `delete_note` needs `confirm: true` as an extra safeguard on top of the `destructiveHint` annotation.
- You can delete from a list row, from the detail view, or with the `Delete` key. Every delete goes through the confirm dialog.
