import { act, renderHook, screen, waitFor } from '@testing-library/react'
import { delay, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { apiError, apiUrl, db } from '../test/handlers'
import { createTestQueryClient, createWrapper } from '../test/render'
import { server } from '../test/server'
import { ApiError } from './client'
import { noteKeys, normalizeSearch, useCreateNote, useDeleteNote, useNote, useNotesSearch } from './notes'
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

  it('treats a 404 as deleted: the note was already gone, e.g. deleted by an agent', async () => {
    server.use(http.delete(apiUrl('/notes/:id'), () => apiError(404, 'not_found', 'Note not found.')))
    const { result } = renderHook(() => ({ list: useNotesSearch(''), remove: useDeleteNote() }), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.list.data).toHaveLength(3))

    act(() => result.current.remove.mutate('n2'))

    await waitFor(() => expect(result.current.remove.isSuccess).toBe(true))
    expect(screen.getByRole('status')).toHaveTextContent('Note deleted')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps a pending delete hidden when the list refetches before the server has deleted it', async () => {
    const { release } = holdDelete('n2')
    const client = createTestQueryClient()
    const { result } = renderHook(() => ({ list: useNotesSearch(''), remove: useDeleteNote() }), {
      wrapper: createWrapper(client),
    })
    await waitFor(() => expect(result.current.list.data).toHaveLength(3))
    act(() => result.current.remove.mutate('n2'))
    await waitFor(() => expect(ids(result.current.list.data)).toEqual(['n1', 'n3']))

    // A refetch (like the 15 s interval or window focus) still gets n2 from the server.
    await act(() => result.current.list.refetch())
    await waitFor(() => expect(result.current.list.isFetching).toBe(false))
    expect(ids(client.getQueryData<Note[]>(noteKeys.list('')))).toContain('n2')
    expect(ids(result.current.list.data)).toEqual(['n1', 'n3'])

    release()
    await waitFor(() => expect(result.current.remove.isSuccess).toBe(true))
    expect(ids(result.current.list.data)).toEqual(['n1', 'n3'])
  })

  it('a failed delete brings back only its own note, not one deleted at the same time', async () => {
    const { release } = holdDelete('n1', () => apiError(500, 'internal', 'Something went wrong. Please try again.'))
    const seen: (string[] | undefined)[] = []
    const { result } = renderHook(
      () => {
        const value = { list: useNotesSearch(''), first: useDeleteNote(), second: useDeleteNote() }
        seen.push(ids(value.list.data))
        return value
      },
      { wrapper: createWrapper() },
    )
    await waitFor(() => expect(result.current.list.data).toHaveLength(3))

    act(() => result.current.first.mutate('n1'))
    act(() => result.current.second.mutate('n2'))
    await waitFor(() => expect(result.current.second.isSuccess).toBe(true))
    await waitFor(() => expect(result.current.list.isFetching).toBe(false))
    // The second delete's refetch must not bring back n1, whose delete is still running.
    expect(ids(result.current.list.data)).toEqual(['n3'])
    const afterSecond = seen.length

    // Slow list responses down like a real network, so a note that briefly
    // reappeared would be rendered (and caught) before the refetch replaced it.
    server.use(
      http.get(apiUrl('/notes'), async () => {
        await delay(50)
      }),
    )
    release()

    await waitFor(() => expect(result.current.first.isError).toBe(true))
    await waitFor(() => expect(ids(result.current.list.data)).toEqual(['n1', 'n3']))
    // n2 never came back, not even for a moment.
    expect(seen.slice(afterSecond).filter((list) => list?.includes('n2'))).toEqual([])
    expect(db.ids()).toEqual(['n1', 'n3'])
  })
})

/** Holds the DELETE for `id` until release(); then answers with `respond` (default: the normal handler). */
function holdDelete(id: string, respond: () => Response | undefined = () => undefined) {
  let release: () => void = () => undefined
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  server.use(
    http.delete(apiUrl('/notes/:id'), async ({ params }) => {
      if (params.id !== id) return undefined
      await released
      return respond()
    }),
  )
  return { release }
}
