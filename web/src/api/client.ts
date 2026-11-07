import { env } from '../config/env'
import type { ApiErrorBody, ApiErrorCode, CreateNoteInput, Note, NotesResponse } from './types'

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

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false
  const { error } = value
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    'message' in error &&
    typeof error.message === 'string'
  )
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
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
    return undefined as T
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ApiError(response.status, 'invalid_response', `The server sent an unexpected response (${response.status}).`)
  }

  if (!response.ok) {
    if (isApiErrorBody(body)) {
      const { code, message, fields } = body.error
      throw new ApiError(response.status, code, message, fields)
    }
    throw new ApiError(response.status, 'invalid_response', `The server sent an unexpected response (${response.status}).`)
  }

  return body as T
}

const notePath = (id: string): string => `/notes/${encodeURIComponent(id)}`

export const notesApi = {
  async search(search: string, signal?: AbortSignal): Promise<Note[]> {
    const query = search ? `?${new URLSearchParams({ search }).toString()}` : ''
    const { notes } = await request<NotesResponse>(`/notes${query}`, { signal })
    return notes
  },

  get(id: string, signal?: AbortSignal): Promise<Note> {
    return request<Note>(notePath(id), { signal })
  },

  create(input: CreateNoteInput): Promise<Note> {
    return request<Note>('/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  },

  delete(id: string): Promise<void> {
    return request<undefined>(notePath(id), { method: 'DELETE' })
  },
}
