import { http, HttpResponse } from 'msw'
import type { CreateNoteInput, Note, NotesPage, ServerErrorCode } from '../api/types'
import { env } from '../config/env'

/** The API's default page size (DefaultPageSize in the Go service). */
const API_DEFAULT_LIMIT = 2

/** Builds a full API URL for MSW handlers, e.g. apiUrl('/notes'). */
export const apiUrl = (path: string): string => `${env.apiBaseUrl}${path}`

/** Responds with the API's shared error shape. */
export function apiError(status: number, code: ServerErrorCode, message: string, fields?: Record<string, string>) {
  return HttpResponse.json({ error: { code, message, fields } }, { status })
}

export const seedNotes: readonly Note[] = [
  { id: 'n1', title: 'Sprint planning', body: 'Goals for the sprint.', tags: ['planning'], createdAt: '2026-11-03T09:00:00Z' },
  { id: 'n2', title: 'API conventions', body: 'One error shape for every endpoint.', tags: ['api', 'go'], createdAt: '2026-11-02T09:00:00Z' },
  { id: 'n3', title: 'Retro notes', body: 'Keep PRs small.', tags: ['team'], createdAt: '2026-11-01T09:00:00Z' },
]

/** A tiny in-memory copy of the API, reset after every test. */
let notes: Note[] = []
/** Counter for new ids (new-1, new-2, …), reset with the notes so ids are predictable per test. */
let created = 0

export const db = {
  reset(): void {
    notes = seedNotes.map((n) => ({ ...n, tags: [...n.tags] }))
    created = 0
  },
  ids(): string[] {
    return notes.map((n) => n.id)
  },
  /** Same rules as the Go API: every term in title, body or a tag, ignoring case, newest first. */
  search(search: string): Note[] {
    const terms = search.toLowerCase().split(/\s+/).filter(Boolean)
    return notes
      .filter((n) =>
        terms.every((term) =>
          [n.title, n.body, ...n.tags].some((field) => field.toLowerCase().includes(term)),
        ),
      )
      .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
  },
  /** One page of search results, like GET /api/notes: skip `offset` matches, return at most `limit`. */
  page(search: string, offset: number, limit: number): NotesPage {
    const matches = db.search(search)
    return { notes: matches.slice(offset, offset + limit), total: matches.length }
  },
  /** Adds a note straight to the "server", as an agent would over MCP. */
  insert(note: Note): void {
    notes.push({ ...note, tags: [...note.tags] })
  },
}
db.reset()

/** A list response holding every note in one page, for handlers that override GET /notes. */
export const singlePage = (list: readonly Note[]) => HttpResponse.json({ notes: list, total: list.length })

/** Reads offset, limit and search from a GET /notes request, with the API's defaults. */
export function pageParams(request: Request): { search: string; offset: number; limit: number } {
  const params = new URL(request.url).searchParams
  return {
    search: params.get('search') ?? '',
    offset: Number(params.get('offset') ?? 0),
    limit: Number(params.get('limit') ?? API_DEFAULT_LIMIT),
  }
}

export const handlers = [
  http.get(apiUrl('/health'), () => HttpResponse.json({ status: 'ok' })),

  http.get(apiUrl('/notes'), ({ request }) => {
    const { search, offset, limit } = pageParams(request)
    return HttpResponse.json(db.page(search, offset, limit))
  }),

  http.get(apiUrl('/notes/:id'), ({ params }) => {
    const note = notes.find((n) => n.id === params.id)
    return note ? HttpResponse.json(note) : apiError(404, 'not_found', 'Note not found.')
  }),

  http.post(apiUrl('/notes'), async ({ request }) => {
    const input = (await request.json()) as CreateNoteInput
    const title = input.title.trim()
    if (!title) {
      return apiError(422, 'validation_failed', 'Some fields are invalid.', { title: 'is required' })
    }
    created += 1
    const note: Note = {
      id: `new-${created}`,
      title,
      body: input.body?.trim() ?? '',
      tags: input.tags ?? [],
      createdAt: new Date().toISOString(),
    }
    notes.push(note)
    return HttpResponse.json(note, { status: 201 })
  }),

  http.delete(apiUrl('/notes/:id'), ({ params }) => {
    const before = notes.length
    notes = notes.filter((n) => n.id !== params.id)
    return notes.length < before
      ? new HttpResponse(null, { status: 204 })
      : apiError(404, 'not_found', 'Note not found.')
  }),
]
