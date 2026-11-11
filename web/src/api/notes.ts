import {
  keepPreviousData,
  skipToken,
  useInfiniteQuery,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query'
import { useCallback } from 'react'
import { useToast } from '../components/toast/toast-context'
import { ApiError, notesApi } from './client'
import type { Note, NotesPage } from './types'

/** How often lists and the open note refetch, so changes made by agents over MCP show up. */
const REFETCH_INTERVAL_MS = 15_000

/** Notes per page in the list (Implementation_Guide.md section 3). */
export const PAGE_SIZE = 2

/** A list as it is cached: the pages loaded so far, each fetched by its offset. */
export type NotesPages = InfiniteData<NotesPage, number>

/** A list as components see it: the loaded notes in order, and how many match in total. */
export interface NotesList {
  notes: Note[]
  total: number
}

/** Trims, collapses whitespace and lowercases, so "Go  API" and "go api" share a cache entry. */
export function normalizeSearch(search: string): string {
  return search.trim().replace(/\s+/g, ' ').toLowerCase()
}

export const noteKeys = {
  all: ['notes'] as const,
  lists: () => [...noteKeys.all, 'list'] as const,
  list: (search: string) => [...noteKeys.lists(), normalizeSearch(search)] as const,
  details: () => [...noteKeys.all, 'detail'] as const,
  detail: (id: string) => [...noteKeys.details(), id] as const,
}

/** Identifies delete mutations, so lists can hide the notes being deleted. */
const deleteNoteKey = [...noteKeys.all, 'delete'] as const

/** Ids of the notes whose delete request hasn't finished yet. */
function usePendingDeletes(): string[] {
  return useMutationState({
    filters: { mutationKey: deleteNoteKey, status: 'pending' },
    select: (mutation) => mutation.state.variables,
  }).filter((id): id is string => typeof id === 'string')
}

/**
 * The offset of the page after `last` (fetched at `offset`), or undefined when
 * there are no more: the page was empty, or it reached `total`.
 */
export function nextOffset(last: NotesPage, offset: number): number | undefined {
  const next = offset + last.notes.length
  return last.notes.length > 0 && next < last.total ? next : undefined
}

/**
 * Joins the loaded pages into one list. A note is kept once, where it first
 * appears: offsets shift when notes are created or deleted between page
 * loads, so a note can come back on the next page. Notes in `hidden` (being
 * deleted) are left out, and `total` drops by one for each.
 */
export function flattenPages(data: NotesPages, hidden: ReadonlySet<string> = new Set()): NotesList {
  const seen = new Set<string>()
  const notes: Note[] = []
  let hiddenCount = 0
  for (const note of data.pages.flatMap((page) => page.notes)) {
    if (seen.has(note.id)) continue
    seen.add(note.id)
    if (hidden.has(note.id)) hiddenCount += 1
    else notes.push(note)
  }
  const total = data.pages[0]?.total ?? 0
  return { notes, total: Math.max(total - hiddenCount, notes.length) }
}

/**
 * One list of notes matching `search` (all notes when empty), newest first,
 * loaded `PAGE_SIZE` at a time: `fetchNextPage()` loads the next page while
 * `hasNextPage` is true. `data` is the loaded notes plus the total. While a
 * new search loads, the previous results stay in `data` and
 * `isPlaceholderData` is true. A refetch (interval, window focus, after a
 * create or delete) reloads every loaded page in order from offset 0.
 *
 * Notes being deleted are left out. That is the optimistic part of a delete:
 * a refetch that lands before the server has deleted the note can't bring it
 * back, and if the delete fails the note simply reappears.
 */
export function useNotesSearch(search: string) {
  const term = normalizeSearch(search)
  // A string key, so the select function only changes when the pending set does.
  const pendingKey = usePendingDeletes().join('\n')
  const select = useCallback(
    (data: NotesPages): NotesList => flattenPages(data, new Set(pendingKey === '' ? [] : pendingKey.split('\n'))),
    [pendingKey],
  )
  return useInfiniteQuery({
    queryKey: noteKeys.list(term),
    queryFn: ({ pageParam, signal }) => notesApi.search(term, pageParam, PAGE_SIZE, signal),
    initialPageParam: 0,
    getNextPageParam: (last, _pages, offset) => nextOffset(last, offset),
    select,
    placeholderData: keepPreviousData,
    refetchInterval: REFETCH_INTERVAL_MS,
  })
}

/** What useNotesSearch returns; the note list takes it as a prop. */
export type NotesQuery = ReturnType<typeof useNotesSearch>

function findInLists(queryClient: QueryClient, id: string): Note | undefined {
  for (const [, data] of queryClient.getQueriesData<NotesPages>({ queryKey: noteKeys.lists() })) {
    for (const page of data?.pages ?? []) {
      const found = page.notes.find((n) => n.id === id)
      if (found) return found
    }
  }
  return undefined
}

/** Removes the note from every page; if it was in the list, every page's total drops by one. */
function removeFromPages(data: NotesPages, id: string): NotesPages {
  if (!data.pages.some((page) => page.notes.some((n) => n.id === id))) return data
  return {
    ...data,
    pages: data.pages.map((page) => ({
      notes: page.notes.filter((n) => n.id !== id),
      total: Math.max(page.total - 1, 0),
    })),
  }
}

type NoteDetailKey = ReturnType<typeof noteKeys.detail>

/**
 * One note. Shows the copy from a loaded list at once while the fresh one
 * loads, and refetches like the lists so a note deleted by an agent turns
 * into "Note not found".
 */
export function useNote(id: string | undefined) {
  const queryClient = useQueryClient()
  // Explicit types: otherwise TypeScript infers the data type from placeholderData.
  return useQuery<Note, ApiError, Note, NoteDetailKey>({
    queryKey: noteKeys.detail(id ?? ''),
    queryFn: id === undefined ? skipToken : ({ signal }) => notesApi.get(id, signal),
    placeholderData: () => (id === undefined ? undefined : findInLists(queryClient, id)),
    refetchInterval: REFETCH_INTERVAL_MS,
  })
}

/**
 * Creates a note, then refetches the lists so it appears in the right place
 * for every search. Errors (including 422 field errors) are left to the form.
 */
export function useCreateNote() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: notesApi.create,
    onSuccess: (note) => {
      queryClient.setQueryData(noteKeys.detail(note.id), note)
      toast.success('Note created')
      // Not awaited: the dialog can close while the lists refetch.
      void queryClient.invalidateQueries({ queryKey: noteKeys.lists() })
    },
  })
}

/** Deletes a note. A note that is already gone (e.g. an agent deleted it) counts as deleted. */
async function deleteNote(id: string): Promise<void> {
  try {
    await notesApi.delete(id)
  } catch (error) {
    if (error instanceof ApiError && error.code === 'not_found') return
    throw error
  }
}

/**
 * Deletes a note optimistically: useNotesSearch hides it while the request
 * runs. On success it is removed from every page of every cached list, then
 * the lists refetch so the pages line up with the server again; on failure it
 * comes back on its own, with an error toast.
 */
export function useDeleteNote() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationKey: deleteNoteKey,
    mutationFn: deleteNote,
    onSuccess: (_data, id) => {
      queryClient.setQueriesData<NotesPages>({ queryKey: noteKeys.lists() }, (data) => data && removeFromPages(data, id))
      queryClient.removeQueries({ queryKey: noteKeys.detail(id) })
      toast.success('Note deleted')
    },
    onError: (error) => {
      toast.error(`Couldn't delete the note. ${error.message}`)
    },
    // Awaited, so the note stays hidden until the lists have caught up.
    onSettled: () => queryClient.invalidateQueries({ queryKey: noteKeys.lists() }),
  })
}
