import { act, renderHook, screen, waitFor } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { apiError, apiUrl, db, pageParams } from '../test/handlers'
import { createTestQueryClient, createWrapper } from '../test/render'
import { server } from '../test/server'
import { ApiError } from './client'
import {
  flattenPages,
  nextOffset,
  noteKeys,
  normalizeSearch,
  PAGE_SIZE,
  useCreateNote,
  useDeleteNote,
  useNote,
  useNotesSearch,
  type NotesList,
  type NotesPages,
  type NotesQuery,
} from './notes'
import type { Note } from './types'

const ids = (list: NotesList | undefined): string[] | undefined => list?.notes.map((n) => n.id)

const note = (id: string): Note => ({ id, title: id, body: '', tags: [], createdAt: '2026-11-01T09:00:00Z' })

/** Cached pages, as useInfiniteQuery stores them. */
const pages = (...list: { ids: string[]; total: number }[]): NotesPages => ({
  pages: list.map((p) => ({ notes: p.ids.map(note), total: p.total })),
  pageParams: list.map((_, i) => i * PAGE_SIZE),
})

/**
 * Loads every page of a list, as the note list does while you scroll.
 *
 * Checks use the result fetchNextPage returns: TanStack Query only re-renders
 * a hook for result fields that were read before they changed, so
 * `result.current` can lag behind in a test that reads a field for the first
 * time afterwards.
 */
async function loadAllPages(list: () => NotesQuery): Promise<void> {
  await waitFor(() => expect(list().isSuccess).toBe(true))
  let hasNextPage = list().hasNextPage
  while (hasNextPage) {
    hasNextPage = (await act(() => list().fetchNextPage())).hasNextPage
  }
}

/** Records the offset and limit of every GET /notes, then lets the default handler answer. */
function recordListRequests(): { offset: number; limit: number }[] {
  const requests: { offset: number; limit: number }[] = []
  server.use(
    http.get(apiUrl('/notes'), ({ request }) => {
      const { offset, limit } = pageParams(request)
      requests.push({ offset, limit })
      return undefined
    }),
  )
  return requests
}

describe('normalizeSearch', () => {
  it('trims, collapses whitespace and lowercases', () => {
    expect(normalizeSearch('  Go   API ')).toBe('go api')
  })
})

describe('nextOffset', () => {
  it.each([
    ['the next offset while notes remain', { notes: [note('a'), note('b')], total: 5 }, 0, 2],
    ['the offset after a short page', { notes: [note('c')], total: 5 }, 2, 3],
    ['nothing once the total is reached', { notes: [note('e')], total: 5 }, 4, undefined],
    ['nothing after an empty page, even if total says more', { notes: [], total: 5 }, 4, undefined],
  ])('gives %s', (_case, page, offset, want) => {
    expect(nextOffset(page, offset)).toBe(want)
  })
})

describe('flattenPages', () => {
  it('joins the pages in order, with the total from the first page', () => {
    expect(flattenPages(pages({ ids: ['a', 'b'], total: 3 }, { ids: ['c'], total: 3 }))).toEqual({
      notes: [note('a'), note('b'), note('c')],
      total: 3,
    })
  })

  it('keeps a note that appears on two pages once, where it first appears', () => {
    // A note created between page loads shifted "b" onto the second page too.
    const list = flattenPages(pages({ ids: ['a', 'b'], total: 4 }, { ids: ['b', 'c'], total: 5 }))

    expect(ids(list)).toEqual(['a', 'b', 'c'])
  })

  it('hides notes being deleted and lowers the total for each', () => {
    const list = flattenPages(pages({ ids: ['a', 'b'], total: 3 }, { ids: ['c'], total: 3 }), new Set(['b', 'zz']))

    expect(ids(list)).toEqual(['a', 'c'])
    // "zz" isn't loaded, so it doesn't count.
    expect(list.total).toBe(2)
  })
})

describe('useNotesSearch', () => {
  it('loads the first page of 2, newest first, with the total', async () => {
    const requests = recordListRequests()
    const { result } = renderHook(() => useNotesSearch(''), { wrapper: createWrapper() })

    await waitFor(() => expect(ids(result.current.data)).toEqual(['n1', 'n2']))
    expect(result.current.data?.total).toBe(3)
    expect(result.current.hasNextPage).toBe(true)
    expect(requests).toEqual([{ offset: 0, limit: PAGE_SIZE }])
  })

  it('loads the next page from the next offset, then has no more', async () => {
    const requests = recordListRequests()
    const { result } = renderHook(() => useNotesSearch(''), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.hasNextPage).toBe(true))

    const after = await act(() => result.current.fetchNextPage())

    expect(ids(after.data)).toEqual(['n1', 'n2', 'n3'])
    expect(after.hasNextPage).toBe(false)
    expect(requests).toEqual([
      { offset: 0, limit: PAGE_SIZE },
      { offset: 2, limit: PAGE_SIZE },
    ])
  })

  it.each([
    ['title', '  API  ', ['n2']],
    ['body', 'PRS small', ['n3']],
    ['tags', 'planning', ['n1']],
    ['part of a word ("go" in "Goals" and the "go" tag)', 'go', ['n1', 'n2']],
  ])('matches the search in the %s, ignoring case', async (_where, search, want) => {
    const { result } = renderHook(() => useNotesSearch(search), { wrapper: createWrapper() })

    await waitFor(() => expect(ids(result.current.data)).toEqual(want))
    expect(result.current.hasNextPage).toBe(false)
  })

  it('keeps the previous results on screen while a new search loads', async () => {
    const { result, rerender } = renderHook(({ search }) => useNotesSearch(search), {
      wrapper: createWrapper(),
      initialProps: { search: '' },
    })
    await waitFor(() => expect(ids(result.current.data)).toEqual(['n1', 'n2']))

    server.use(
      http.get(apiUrl('/notes'), async ({ request }) => {
        await delay(50)
        const { search, offset, limit } = pageParams(request)
        return HttpResponse.json(db.page(search, offset, limit))
      }),
    )
    rerender({ search: 'retro' })

    // Old results stay while the new search is in flight.
    expect(ids(result.current.data)).toEqual(['n1', 'n2'])
    expect(result.current.isPlaceholderData).toBe(true)

    await waitFor(() => expect(result.current.isPlaceholderData).toBe(false))
    expect(ids(result.current.data)).toEqual(['n3'])
  })

  it('shows a note once when a new note shifts it onto the next page, and a refetch lines the pages up again', async () => {
    const { result } = renderHook(() => useNotesSearch(''), { wrapper: createWrapper() })
    await waitFor(() => expect(ids(result.current.data)).toEqual(['n1', 'n2']))

    // An agent adds a newer note, so n2 moves from offset 1 to offset 2.
    db.insert({ ...note('n0'), title: 'From an agent', createdAt: '2026-11-04T09:00:00Z' })
    const shifted = await act(() => result.current.fetchNextPage())

    // The second page (offset 2) is [n2, n3]; n2 is already shown, so it's kept once.
    expect(ids(shifted.data)).toEqual(['n1', 'n2', 'n3'])

    const refetched = await act(() => result.current.refetch())

    expect(ids(refetched.data)).toEqual(['n0', 'n1', 'n2', 'n3'])
    expect(refetched.data?.total).toBe(4)
  })

  it('turns an API error into a typed ApiError', async () => {
    server.use(http.get(apiUrl('/notes'), () => apiError(500, 'internal', 'Something went wrong. Please try again.')))

    const { result } = renderHook(() => useNotesSearch(''), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeInstanceOf(ApiError)
    expect(result.current.error).toMatchObject({ status: 500, code: 'internal' })
  })

  it('reports a failed next page, keeping the loaded notes', async () => {
    const { result } = renderHook(() => useNotesSearch(''), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.hasNextPage).toBe(true))
    server.use(http.get(apiUrl('/notes'), () => apiError(500, 'internal', 'Something went wrong. Please try again.')))

    const after = await act(() => result.current.fetchNextPage())

    expect(after.isFetchNextPageError).toBe(true)
    expect(after.error?.code).toBe('internal')
    expect(ids(after.data)).toEqual(['n1', 'n2'])
  })
})

describe('useNote', () => {
  it('loads one note', async () => {
    const { result } = renderHook(() => useNote('n2'), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.data?.title).toBe('API conventions'))
  })

  it('shows the copy from any loaded page of a list while the note loads', async () => {
    const client = createTestQueryClient()
    const list = renderHook(() => useNotesSearch(''), { wrapper: createWrapper(client) })
    await loadAllPages(() => list.result.current)
    server.use(
      http.get(apiUrl('/notes/:id'), async () => {
        await delay('infinite')
      }),
    )

    const { result } = renderHook(() => useNote('n3'), { wrapper: createWrapper(client) })

    // n3 is on the second page.
    expect(result.current.data?.title).toBe('Retro notes')
    expect(result.current.isPlaceholderData).toBe(true)
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
    await loadAllPages(() => result.current.list)

    act(() => result.current.create.mutate({ title: 'New idea', tags: ['ideas'] }))

    // The refetch reloads both loaded pages, now starting with the new note.
    await waitFor(() => expect(ids(result.current.list.data)).toEqual(['new-1', 'n1', 'n2', 'n3']))
    expect(result.current.list.data?.total).toBe(4)
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
  it('removes the note at once, lowers the total and shows a success toast', async () => {
    const { result } = renderHook(() => ({ list: useNotesSearch(''), remove: useDeleteNote() }), {
      wrapper: createWrapper(),
    })
    await loadAllPages(() => result.current.list)

    act(() => result.current.remove.mutate('n2'))

    await waitFor(() => expect(ids(result.current.list.data)).toEqual(['n1', 'n3']))
    await waitFor(() => expect(result.current.remove.isSuccess).toBe(true))
    expect(result.current.list.data?.total).toBe(2)
    expect(screen.getByRole('status')).toHaveTextContent('Note deleted')
    expect(db.ids()).toEqual(['n1', 'n3'])
  })

  it('removes the note from its page in every cached list', async () => {
    const client = createTestQueryClient()
    const { result } = renderHook(() => ({ list: useNotesSearch(''), remove: useDeleteNote() }), {
      wrapper: createWrapper(client),
    })
    await loadAllPages(() => result.current.list)
    // Keep the cache as the delete left it: no refetch afterwards.
    server.use(
      http.get(apiUrl('/notes'), async () => {
        await delay('infinite')
      }),
    )

    act(() => result.current.remove.mutate('n3'))
    // The mutation itself stays pending: it waits for the (held) refetch.
    expect(await screen.findByRole('status')).toHaveTextContent('Note deleted')

    const cached = client.getQueryData<NotesPages>(noteKeys.list(''))
    expect(cached?.pages.map((page) => page.notes.map((n) => n.id))).toEqual([['n1', 'n2'], []])
    expect(cached?.pages.map((page) => page.total)).toEqual([2, 2])
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
    await loadAllPages(() => result.current.list)

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
    await loadAllPages(() => result.current.list)

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
    await loadAllPages(() => result.current.list)
    act(() => result.current.remove.mutate('n2'))
    await waitFor(() => expect(ids(result.current.list.data)).toEqual(['n1', 'n3']))

    // A refetch (like the 15 s interval or window focus) still gets n2 from the server.
    await act(() => result.current.list.refetch())
    await waitFor(() => expect(result.current.list.isFetching).toBe(false))
    const cachedIds = client.getQueryData<NotesPages>(noteKeys.list(''))?.pages.flatMap((p) => p.notes.map((n) => n.id))
    expect(cachedIds).toContain('n2')
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
    await loadAllPages(() => result.current.list)

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
