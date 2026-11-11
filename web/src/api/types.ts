// Types that mirror the Go API (Implementation_Guide.md sections 3 and 4).

export interface Note {
  id: string
  title: string
  body: string
  tags: string[]
  /** RFC 3339 timestamp in UTC. */
  createdAt: string
}

export interface CreateNoteInput {
  title: string
  body?: string
  tags?: string[]
}

/** One page of GET /api/notes. */
export interface NotesPage {
  /** This page of matching notes, newest first. */
  notes: Note[]
  /** How many notes match in total, across all pages. */
  total: number
}

/** Codes the API sends in error.code. */
export const SERVER_ERROR_CODES = [
  'bad_request',
  'not_found',
  'method_not_allowed',
  'payload_too_large',
  'unsupported_media_type',
  'validation_failed',
  'internal',
] as const

export type ServerErrorCode = (typeof SERVER_ERROR_CODES)[number]

/**
 * Codes the client adds when there is no usable API response: the server
 * can't be reached, or it answers with something that isn't the expected
 * shape (including an error code this app doesn't know).
 */
export type ClientErrorCode = 'network_error' | 'invalid_response'

export type ApiErrorCode = ServerErrorCode | ClientErrorCode
