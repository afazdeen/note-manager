import { describe, expect, it } from 'vitest'
import { validateNote } from './validateNote'

describe('validateNote title', () => {
  it('accepts accents and emoji, including ones joined with a zero-width joiner', () => {
    expect(validateNote({ title: 'Café 👩‍💻 review' })).toEqual({})
  })

  it('trims surrounding line breaks before checking', () => {
    expect(validateNote({ title: '\n Standup \n' })).toEqual({})
  })

  it.each([
    ['a line break', 'first\nsecond'],
    ['a tab', 'a\tb'],
    ['a NUL character', 'a\u0000b'],
    ['a right-to-left override', 'invoice‮txt.exe'],
  ])('rejects %s, like the server', (_name, title) => {
    expect(validateNote({ title }).title).toBe('Title must be a single line without control characters.')
  })
})
