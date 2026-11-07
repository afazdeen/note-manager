# Implementation Guide: Team Notes

A small notes app that people (React UI) and AI agents (MCP) both use. One Go server holds the notes in memory. REST and MCP call the same service, so both see the same data. The time budget is about 3 hours.

## 1. Requirements checklist

| #  | Requirement | Delivered by |
|----|-------------|--------------|
| R1 | Backend API: create, list, search, delete. Notes in memory. A few meaningful tests | `api/`: Go standard library, `note` package (note / service / memory repository), `httptest` tests |
| R2 | React + TypeScript UI: list and detail views, loading/empty/error states, keyboard friendly | `web/`: Vite, TanStack Query, Tailwind |
| R3 | One Web Component used inside React | `<tag-input>` tag picker, used in the create form and in the note detail |
| R4 | MCP server with at least 2 tools, plus a note on auth and destructive actions | `/mcp` on the same server: `search_notes`, `create_note`, `delete_note`, plus `api/internal/mcp/note.md` |
| R5 | README: setup, decisions, next steps, AI usage | `README.md` at the root |

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
| title | Required after trimming. 1–120 characters |
| body  | Optional. At most 10,000 characters. Plain text |
| tags  | 0–10 tags. Each one is trimmed, lowercased and de-duplicated, then must match `^[a-z0-9][a-z0-9-]{0,23}$` (1–24 characters: letters, digits, hyphens, not starting with a hyphen) |

All failing fields are returned together, one message per field.

**Search**: the `search` text (the same parameter name in REST and MCP) is trimmed and split on whitespace. A note matches when *every* term appears, case-insensitively, in the title, the body or any tag. An empty or missing `search` returns all notes. Results are always newest first (`createdAt` descending, ties broken by `id`).

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

The server uses the official Go SDK (`github.com/modelcontextprotocol/go-sdk`) and is mounted with `NewStreamableHTTPHandler` on the same mux. Inputs and outputs are typed Go structs, so the SDK generates the JSON schemas.

| Tool | Input | Output | Annotations |
|------|-------|--------|-------------|
| `search_notes` | `search?` string, `limit?` int (1–50, default 10) | `{notes, total}` | `readOnlyHint: true` |
| `create_note` | `title`, `body?`, `tags?` | created `Note` | `readOnlyHint: false`, `destructiveHint: false` |
| `delete_note` | `id`, `confirm` bool | `{deleted: id, title}` | `destructiveHint: true`, `idempotentHint: true` |

`delete_note` refuses unless `confirm` is `true`. It returns a tool error that tells the agent to check with the user first. Validation errors come back as tool errors (`isError: true`) with the same field messages as REST. **`api/internal/mcp/note.md`** is written *after* the server works. It covers authentication (OAuth 2.1 bearer tokens following the MCP auth spec, scoped `notes:read` / `notes:write` / `notes:delete`), destructive actions (annotations, explicit confirm, client-side human approval, audit log, soft delete) and rate limiting.

## 6. Environment and CORS

| File | Variable | Default | Purpose |
|------|----------|---------|---------|
| `api/.env.example` | `PORT` | `8080` | HTTP port |
| | `CORS_ALLOWED_ORIGIN` | `http://localhost:5173` | The only origin allowed to call `/api` from a browser |
| | `SEED_NOTES` | `true` | Load the demo notes on start |
| `web/.env.example` | `VITE_API_BASE_URL` | `http://localhost:8080/api` | API base URL |

`godotenv.Load()` reads `api/.env` if it exists, and real environment variables take priority. The CORS middleware wraps `/api` only. When `Origin` exactly matches the allowed origin, it sets `Access-Control-Allow-Origin` (plus `Vary: Origin`), allows `GET, POST, DELETE` and the `Content-Type` header, and answers preflight requests with 204. Other origins get no CORS headers, so the browser blocks them. Their preflights, and preflights for any other method, are refused with 403. Invalid env values (such as a bad port, a wildcard or a path in the origin, or a non-boolean seed flag) stop the server at startup with every problem listed. `/mcp` gets no CORS headers because MCP clients are not browser pages.

## 7. UI

**Layout.** The header holds the app name, the search box and a **New note** button, above a purple→green gradient bar. Below 768 px, the search box wraps onto its own full-width line. At 768 px and wider there are two panes under the header: the note list on the left (~360 px, with a shortcuts hint at the bottom) and the detail view or create form on the right. Below 768 px there is one pane at a time: the list, then the detail or form with a **Back** button.
- **Selected note:** stored in the URL as `?note=<id>` with `history.pushState` and no router. Links work, and the browser's Back button returns to the list.
- **Mobile focus:** opening a note moves focus to the detail pane, and Back returns focus to that note's row. Each list row shows the title, a 2-line body preview, tag chips, a relative date ("3 h ago") and a delete icon button. The button is labelled "Delete note <title>", is reachable with Tab, and turns red on hover or focus. The detail view shows the title, the full date, the body (whitespace kept), a read-only `<tag-input>` (clicking a tag searches for it) and a red **Delete** button. The create form has a title, a body textarea and an editable `<tag-input>`.

**States**

| Area | Loading | Empty | Error |
|------|---------|-------|-------|
| List | 4 skeleton rows; `aria-busy` | No notes: "No notes yet" + **Create your first note**. No matches: "No notes match "x"" + **Clear search** | Inline red banner + **Retry** |
| Detail | Skeleton block | Nothing selected: "Select a note" | 404: "Note not found" (it may have been deleted, for example by an agent) + **Back to notes**. Other errors: banner + **Retry** |
| Create | Submit button disabled with a spinner | – | Field errors under each input (client-side and from a 422). Other errors: alert at the top of the form; input is kept |
| Delete | Confirm button shows a spinner | – | Error toast; the note stays |

Successful create or delete shows a toast (an `aria-live="polite"` region). After a create, the new note is selected. After a delete, the row is removed from the list right away and restored if the request fails. If the deleted note was open, the next note is selected. Search is debounced by 250 ms and the previous results stay on screen while new ones load.

**Data layer** (`src/api/`):
- **Errors:** every failed call rejects with one `ApiError` (`status`, `code`, `message`, `fields`). TanStack Query is told about it, so `error` is typed everywhere. When there's no usable API response, the client adds `network_error` (status 0) or `invalid_response`.
- **Retries:** queries retry once on network and 5xx errors, and never on 4xx.
- **Search:** search text is trimmed, its whitespace collapsed and lowercased before it's used as the query key. Lists refetch every 15 s.
- **Create:** refetches all lists, so the new note shows up in the right place for every search.
- **Delete:** removes the note from every cached list at once. If the request fails, it puts it back and shows an error toast.

**Toasts:** no library. Success toasts last 4 s and errors 8 s. At most 3 show at once, and each has a dismiss button. Success uses `role="status"` and errors `role="alert"`.

**Keyboard** (single-key shortcuts don't fire while typing in a field)

| Key | Action |
|-----|--------|
| `/` | Focus search |
| `n` | New note |
| `↑` / `↓` | Move through the list (focus moves between rows) |
| `Enter` | Open the focused note |
| `Delete` | Delete the focused list row or the open note (opens the confirm dialog) |
| `Ctrl/⌘ + Enter` | Submit the create form |
| `Esc` | Close the dialog, cancel the form, or clear the search |

The confirm dialog traps focus and starts on **Cancel**. Every control has a visible focus ring, and the app respects `prefers-reduced-motion`. A shortcuts hint sits at the bottom of the list pane.

## 8. Web Component: `<tag-input>`

This is a framework-free custom element written in TypeScript with a Shadow DOM. It is registered once in `main.tsx`.

| API | Details |
|-----|---------|
| Attributes | `value` (comma-separated initial tags), `placeholder`, `max-tags` (default 10), `readonly`, `disabled`, `label` (accessible name) |
| Property | `tags: string[]` (get/set) |
| Events | `tags-change` → `detail: {tags}`, and `tag-click` → `detail: {tag}` (readonly mode). Both bubble and are composed |
| Keys | `Enter` or `,` adds a tag. `Backspace` on an empty input removes the last tag. Pasting `a, b, c` adds several. Each chip has a × button labelled "Remove tag x" |
| Rules | The same normalisation and regex as the backend. An invalid tag shows an inline hint (`aria-describedby`) and is not added |
| Styling | CSS custom properties `--tag-bg`, `--tag-fg`, `--tag-focus`, plus `::part(chip)` and `::part(input)` |

A small `TagInput.tsx` wrapper connects props and events with a `ref`, and a JSX type declaration makes `<tag-input>` type-safe.

## 9. Design tokens

The tokens are defined once in Tailwind v4 `@theme` (`web/src/index.css`). Tailwind's default palette is removed, so only these colours exist. Text contrast meets WCAG AA (at least 4.5:1).

| Token | Hex | Used for |
|-------|-----|----------|
| `bg` / `white` | `#ffffff` | Page background / text on filled purple and red buttons (same value) |
| `surface` | `#faf8fd` | List pane and cards |
| `border` | `#e7e2f0` | Dividers and input borders |
| `ink` / `ink-muted` | `#1d1630` / `#5e5873` | Main text / secondary text and dates |
| `purple-50` | `#f6effe` | Hover and the selected list row |
| `purple-100` | `#ead9fc` | Tag chip background |
| `purple-500` | `#9d52e8` | **Base**: focus ring, selected-row edge, gradient start |
| `purple-600` | `#8636d6` | Primary button background (white text, ~6:1) |
| `purple-700` | `#6c25b3` | Primary hover, links, tag chip text |
| `green-50` | `#ebfff4` | Success toast background |
| `green-400` | `#33ff94` | **Base**: gradient end, small accent dot only (never text) |
| `green-700` | `#0a7a40` | Success text and icons (~5.4:1) |
| `red-50` / `red-600` / `red-700` | `#fef2f2` / `#dc2626` / `#b91c1c` | Error banner background / error text and Delete button / Delete hover |
| `gradient-brand` | `linear-gradient(90deg, #9d52e8, #33ff94)` | Header bar and the empty-state illustration accent (utility: `bg-gradient-brand`) |

## 10. Folder layout

```
api/
  cmd/server/main.go              config, seed data, mux wiring, graceful shutdown
  internal/config/config.go
  internal/note/                  note.go (type, validation)  service.go (+ Repository interface)  memory.go  seed.go  *_test.go
  internal/httpapi/               handlers.go  errors.go  json.go  cors.go  logging.go  recover.go  *_test.go
  internal/mcp/                   server.go  tools.go  tools_test.go  note.md
  go.mod  .env.example
web/
  src/config/env.ts               the only reader of import.meta.env (typed, validated)
  src/lib/                        queryClient.ts  format.ts (relative and full dates)
  src/api/                        client.ts  notes.ts (query hooks)  types.ts
  src/components/                 NoteList  NoteDetail  CreateNoteForm  SearchBar  ConfirmDialog  EmptyState  ErrorState  Skeleton  TagChips  buttonStyles.ts
  src/components/toast/           ToastProvider.tsx  toast-context.ts (useToast)
  src/web-components/tag-input/   tag-input.ts  TagInput.tsx  tag-input.test.ts
  src/hooks/                      useShortcuts  useNoteParam (?note=)  useDebouncedValue  useMediaQuery
  src/test/                       MSW handlers + in-memory db, server, setup, render helpers
  App.tsx  main.tsx  index.css
  .env.example  package.json  vite.config.ts  eslint.config.js
.github/workflows/                api.yml  web.yml (lint, test, build when that app's files change, on push and PR)
README.md  Implementation_Guide.md  CLAUDE.md  .gitignore
```

## 11. Test plan

- **Go service**: a table test for validation (missing title, too long, bad tag, tag lowercasing and de-duplication). Search tests for case-insensitivity across title, body and tags, multi-term AND matching, and newest-first order. Delete of an unknown id returns not found.
- **Go HTTP** (`httptest`): POST 201 and 422 with the error shape, GET with `search`, DELETE 204 and 404, CORS preflight from the allowed origin vs another origin.
- **Go MCP** (in-memory transport and SDK client): `create_note` then `search_notes` finds the note. `delete_note` without `confirm` is refused.
- **Web** (Vitest, Testing Library, MSW): list loading, empty, error and retry. The create flow, including a server 422. Deleting from a list row through the confirm dialog. `<tag-input>` add, normalise, Backspace removal and events. The `/` and `n` shortcuts.

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

Editing notes, users and authentication (described in `note.md` only), SQLite and other persistence, pagination, Markdown rendering, live push updates (the UI polls instead), a client-side router (only `?note=` is in the URL), dark mode, Docker and deployment, i18n.

## 14. Assumptions

- There is one shared notebook with no users. Notes are plain text.
- React 19, Tailwind v4, Go 1.22+ (1.27 installed). The selected note is kept in the URL (`?note=<id>`); the search text is not.
- `delete_note` needs `confirm: true` as an extra safeguard on top of the `destructiveHint` annotation.
- You can delete from a list row, from the detail view, or with the `Delete` key. Every delete goes through the confirm dialog.
