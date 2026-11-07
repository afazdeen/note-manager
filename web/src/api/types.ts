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

export interface NotesResponse {
  notes: Note[]
}

/** Codes the API sends in error.code. */
export type ServerErrorCode =
  | 'bad_request'
  | 'not_found'
  | 'method_not_allowed'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'validation_failed'
  | 'internal'

/** Codes the client adds when there is no usable API response. */
export type ClientErrorCode = 'network_error' | 'invalid_response'

export type ApiErrorCode = ServerErrorCode | ClientErrorCode

/** The single error shape every API error uses. */
export interface ApiErrorBody {
  error: {
    code: ServerErrorCode
    message: string
    fields?: Record<string, string>
  }
}
