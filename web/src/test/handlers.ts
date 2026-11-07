import { http, HttpResponse } from 'msw'
import type { CreateNoteInput, Note, ServerErrorCode } from '../api/types'
import { env } from '../config/env'

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
}
db.reset()

export const handlers = [
  http.get(apiUrl('/health'), () => HttpResponse.json({ status: 'ok' })),

  http.get(apiUrl('/notes'), ({ request }) => {
    const search = new URL(request.url).searchParams.get('search') ?? ''
    return HttpResponse.json({ notes: db.search(search) })
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
