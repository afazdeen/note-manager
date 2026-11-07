import { act, renderHook, screen, waitFor } from '@testing-library/react'
import { delay, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { apiError, apiUrl, db } from '../test/handlers'
import { createWrapper } from '../test/render'
import { server } from '../test/server'
import { ApiError } from './client'
import { normalizeSearch, useCreateNote, useDeleteNote, useNote, useNotesSearch } from './notes'
import type { Note } from './types'

const ids = (notes: Note[] | undefined): string[] | undefined => notes?.map((n) => n.id)

describe('normalizeSearch', () => {
  it('trims, collapses whitespace and lowercases', () => {
    expect(normalizeSearch('  Go   API ')).toBe('go api')
  })
})

describe('useNotesSearch', () => {
  it('returns every note, newest first, for an empty search', async () => {
    const { result } = renderHook(() => useNotesSearch(''), { wrapper: createWrapper() })

    await waitFor(() => expect(ids(result.current.data)).toEqual(['n1', 'n2', 'n3']))
  })

  it.each([
    ['title', '  API  ', ['n2']],
    ['body', 'PRS small', ['n3']],
    ['tags', 'planning', ['n1']],
    ['part of a word ("go" in "Goals" and the "go" tag)', 'go', ['n1', 'n2']],
  ])('matches the search in the %s, ignoring case', async (_where, search, want) => {
    const { result } = renderHook(() => useNotesSearch(search), { wrapper: createWrapper() })

    await waitFor(() => expect(ids(result.current.data)).toEqual(want))
  })

  it('keeps the previous results on screen while a new search loads', async () => {
    const { result, rerender } = renderHook(({ search }) => useNotesSearch(search), {
      wrapper: createWrapper(),
      initialProps: { search: '' },
    })
    await waitFor(() => expect(ids(result.current.data)).toEqual(['n1', 'n2', 'n3']))

    server.use(
      http.get(apiUrl('/notes'), async ({ request }) => {
        await delay(50)
        const search = new URL(request.url).searchParams.get('search') ?? ''
        return Response.json({ notes: db.search(search) })
      }),
    )
    rerender({ search: 'retro' })

    // Old results stay while the new search is in flight.
    expect(ids(result.current.data)).toEqual(['n1', 'n2', 'n3'])
    expect(result.current.isPlaceholderData).toBe(true)

    await waitFor(() => expect(result.current.isPlaceholderData).toBe(false))
    expect(ids(result.current.data)).toEqual(['n3'])
  })

  it('turns an API error into a typed ApiError', async () => {
    server.use(http.get(apiUrl('/notes'), () => apiError(500, 'internal', 'Something went wrong. Please try again.')))

    const { result } = renderHook(() => useNotesSearch(''), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeInstanceOf(ApiError)
    expect(result.current.error).toMatchObject({ status: 500, code: 'internal' })
  })
})

describe('useNote', () => {
  it('loads one note', async () => {
    const { result } = renderHook(() => useNote('n2'), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.data?.title).toBe('API conventions'))
  })

  it('reports a missing note as not_found', async () => {
    const { result } = renderHook(() => useNote('missing'), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.error?.code).toBe('not_found'))
  })

  it('does not fetch without an id', () => {
    const { result } = renderHook(() => useNote(undefined), { wrapper: createWrapper() })

    expect(result.current.fetchStatus).toBe('idle')
  })
})

describe('useCreateNote', () => {
  it('adds the new note to the list and shows a success toast', async () => {
    const { result } = renderHook(() => ({ list: useNotesSearch(''), create: useCreateNote() }), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.list.data).toHaveLength(3))

    act(() => result.current.create.mutate({ title: 'New idea', tags: ['ideas'] }))

    await waitFor(() => expect(ids(result.current.list.data)).toEqual(['new-1', 'n1', 'n2', 'n3']))
    expect(screen.getByRole('status')).toHaveTextContent('Note created')
  })

  it('rejects with field errors when validation fails', async () => {
    const { result } = renderHook(() => useCreateNote(), { wrapper: createWrapper() })

    let error: unknown
    await act(async () => {
      error = await result.current.mutateAsync({ title: '   ' }).catch((e: unknown) => e)
    })

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 422, code: 'validation_failed', fields: { title: 'is required' } })
    expect(db.ids()).toEqual(['n1', 'n2', 'n3'])
  })
})

describe('useDeleteNote', () => {
  it('removes the note at once and shows a success toast', async () => {
    const { result } = renderHook(() => ({ list: useNotesSearch(''), remove: useDeleteNote() }), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.list.data).toHaveLength(3))

    act(() => result.current.remove.mutate('n2'))

    await waitFor(() => expect(ids(result.current.list.data)).toEqual(['n1', 'n3']))
    await waitFor(() => expect(result.current.remove.isSuccess).toBe(true))
    expect(screen.getByRole('status')).toHaveTextContent('Note deleted')
    expect(db.ids()).toEqual(['n1', 'n3'])
  })

  it('removes the note optimistically, then rolls back and shows an error when the delete fails', async () => {
    // Hold the DELETE response until the test has checked the optimistic state.
    let respond: () => void = () => undefined
    const responded = new Promise<void>((resolve) => {
      respond = resolve
    })
    server.use(
      http.delete(apiUrl('/notes/:id'), async () => {
        await responded
        return apiError(500, 'internal', 'Something went wrong. Please try again.')
      }),
    )

    const { result } = renderHook(() => ({ list: useNotesSearch(''), remove: useDeleteNote() }), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.list.data).toHaveLength(3))

    act(() => result.current.remove.mutate('n2'))

    // Optimistic: gone from the list before the server answers.
    await waitFor(() => expect(ids(result.current.list.data)).toEqual(['n1', 'n3']))
    respond()

    // Rolled back once the server fails.
    await waitFor(() => expect(ids(result.current.list.data)).toEqual(['n1', 'n2', 'n3']))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't delete the note. Something went wrong. Please try again.",
    )
    expect(db.ids()).toEqual(['n1', 'n2', 'n3'])
  })
})
