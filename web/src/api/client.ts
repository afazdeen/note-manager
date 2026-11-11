import { env } from '../config/env'
import { SERVER_ERROR_CODES, type ApiErrorCode, type CreateNoteInput, type Note, type NotesPage, type ServerErrorCode } from './types'

/** Every failed API call rejects with an ApiError, so callers handle one type. */
export class ApiError extends Error {
  override readonly name = 'ApiError'

  constructor(
    /** HTTP status, or 0 when the server couldn't be reached. */
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    /** Per-field messages for validation errors (422). */
    readonly fields: Readonly<Record<string, string>> = {},
  ) {
    super(message)
  }
}

// Tell TanStack Query that query and mutation errors are ApiErrors.
declare module '@tanstack/react-query' {
  interface Register {
    defaultError: ApiError
  }
}

const NETWORK_ERROR_MESSAGE = "Can't reach the server. Check your connection and try again."

const unexpectedResponse = (status: number): ApiError =>
  new ApiError(status, 'invalid_response', `The server sent an unexpected response (${status}).`)

// ---- Response checks: the API is another program, so its responses are checked, not cast. ----

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isString = (value: unknown): value is string => typeof value === 'string'

function isNote(value: unknown): value is Note {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.title) &&
    isString(value.body) &&
    isString(value.createdAt) &&
    Array.isArray(value.tags) &&
    value.tags.every(isString)
  )
}

function isNotesPage(value: unknown): value is NotesPage {
  return (
    isRecord(value) &&
    Array.isArray(value.notes) &&
    value.notes.every(isNote) &&
    typeof value.total === 'number' &&
    Number.isInteger(value.total) &&
    value.total >= 0
  )
}

const isServerErrorCode = (code: string): code is ServerErrorCode => SERVER_ERROR_CODES.some((known) => known === code)

/** Turns an error response into an ApiError. Unknown codes become invalid_response, keeping the message. */
function toApiError(status: number, body: unknown): ApiError {
  if (!isRecord(body) || !isRecord(body.error)) return unexpectedResponse(status)
  const { code, message, fields } = body.error
  if (!isString(code) || !isString(message)) return unexpectedResponse(status)

  const fieldMessages: Record<string, string> = {}
  if (isRecord(fields)) {
    for (const [field, text] of Object.entries(fields)) {
      if (isString(text)) fieldMessages[field] = text
    }
  }
  return new ApiError(status, isServerErrorCode(code) ? code : 'invalid_response', message, fieldMessages)
}

/** Sends a request and returns the parsed body (undefined for 204). Failures reject with an ApiError. */
async function send(path: string, init: RequestInit = {}): Promise<{ status: number; body: unknown }> {
  let response: Response
  try {
    response = await fetch(`${env.apiBaseUrl}${path}`, {
      ...init,
      headers: { Accept: 'application/json', ...init.headers },
    })
  } catch (error) {
    // TanStack Query cancels requests through the signal; let that through as is.
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(0, 'network_error', NETWORK_ERROR_MESSAGE)
  }

  if (response.status === 204) {
    return { status: 204, body: undefined }
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw unexpectedResponse(response.status)
  }

  if (!response.ok) throw toApiError(response.status, body)
  return { status: response.status, body }
}

/** Sends a request and checks that the body has the expected shape. */
async function request<T>(path: string, init: RequestInit, isExpected: (body: unknown) => body is T): Promise<T> {
  const { status, body } = await send(path, init)
  if (!isExpected(body)) throw unexpectedResponse(status)
  return body
}

const notePath = (id: string): string => `/notes/${encodeURIComponent(id)}`

export const notesApi = {
  /** One page of the notes matching `search` (all notes when empty), newest first. */
  search(search: string, offset: number, limit: number, signal?: AbortSignal): Promise<NotesPage> {
    const params = new URLSearchParams({ offset: String(offset), limit: String(limit) })
    if (search) params.set('search', search)
    return request(`/notes?${params.toString()}`, { signal }, isNotesPage)
  },

  get(id: string, signal?: AbortSignal): Promise<Note> {
    return request(notePath(id), { signal }, isNote)
  },

  create(input: CreateNoteInput): Promise<Note> {
    return request(
      '/notes',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
      isNote,
    )
  },

  async delete(id: string): Promise<void> {
    await send(notePath(id), { method: 'DELETE' })
  },
}
