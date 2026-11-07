import type { CreateNoteInput } from '../api/types'
import { MAX_TAGS, cleanTags } from '../web-components/tag-input/tag-rules'

// Same limits as the Go API (api/internal/note/note.go).
export const MAX_TITLE_LENGTH = 120
export const MAX_BODY_LENGTH = 10_000

export type NoteField = 'title' | 'body' | 'tags'
export type NoteFieldErrors = Partial<Record<NoteField, string>>

const LABELS: Record<NoteField, string> = { title: 'Title', body: 'Body', tags: 'Tags' }

/** Counts characters the way Go counts runes, so "é" or an emoji is one. */
const length = (text: string): number => [...text].length
const formatNumber = (n: number): string => n.toLocaleString('en')

/**
 * Control characters (line breaks, tabs) and bidirectional controls (such as
 * U+202E, which shows text in a different order than it is stored). Titles
 * can't contain them; the server uses the same rule.
 */
const TITLE_CONTROL = /[\p{Cc}\p{Bidi_Control}]/u

/** Checks a note the same way the server does. Returns one message per invalid field. */
export function validateNote(input: CreateNoteInput): NoteFieldErrors {
  const errors: NoteFieldErrors = {}

  const title = input.title.trim()
  if (title === '') {
    errors.title = 'Title is required.'
  } else if (length(title) > MAX_TITLE_LENGTH) {
    errors.title = `Title must be at most ${MAX_TITLE_LENGTH} characters (it has ${formatNumber(length(title))}).`
  } else if (TITLE_CONTROL.test(title)) {
    errors.title = 'Title must be a single line without control characters.'
  }

  const body = (input.body ?? '').trim()
  if (length(body) > MAX_BODY_LENGTH) {
    errors.body = `Body must be at most ${formatNumber(MAX_BODY_LENGTH)} characters (it has ${formatNumber(length(body))}).`
  }

  const tags = input.tags ?? []
  if (cleanTags(tags).length !== tags.length) {
    errors.tags = 'Some tags are not valid.'
  } else if (tags.length > MAX_TAGS) {
    errors.tags = `Use at most ${MAX_TAGS} tags.`
  }

  return errors
}

export const hasErrors = (errors: NoteFieldErrors): boolean => Object.keys(errors).length > 0

/**
 * Turns the API's 422 field messages (e.g. title: "is required") into
 * sentences for the form ("Title is required."). Unknown fields are dropped.
 */
export function fromServerFields(fields: Readonly<Record<string, string>>): NoteFieldErrors {
  const errors: NoteFieldErrors = {}
  for (const field of Object.keys(LABELS) as NoteField[]) {
    const message = fields[field]
    if (!message) continue
    const startsWithVerb = /^(is|must|are)\b/.test(message)
    const sentence = startsWithVerb ? `${LABELS[field]} ${message}` : message.charAt(0).toUpperCase() + message.slice(1)
    errors[field] = sentence.endsWith('.') ? sentence : `${sentence}.`
  }
  return errors
}
