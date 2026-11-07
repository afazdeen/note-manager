import {
  keepPreviousData,
  skipToken,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { useCallback } from 'react'
import { useToast } from '../components/toast/toast-context'
import { ApiError, notesApi } from './client'
import type { Note } from './types'

/** How often lists and the open note refetch, so changes made by agents over MCP show up. */
const REFETCH_INTERVAL_MS = 15_000

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
 * Notes matching `search` (all notes when empty), newest first. While a new
 * search loads, the previous results stay in `data` and `isPlaceholderData` is true.
 *
 * Notes being deleted are left out. That is the optimistic part of a delete:
 * a refetch that lands before the server has deleted the note can't bring it
 * back, and if the delete fails the note simply reappears.
 */
export function useNotesSearch(search: string) {
  const term = normalizeSearch(search)
  // A string key, so the select function only changes when the pending set does.
  const pendingKey = usePendingDeletes().join('\n')
  const hidePending = useCallback(
    (notes: Note[]): Note[] => {
      if (pendingKey === '') return notes
      const pending = new Set(pendingKey.split('\n'))
      return notes.filter((n) => !pending.has(n.id))
    },
    [pendingKey],
  )
  return useQuery({
    queryKey: noteKeys.list(term),
    queryFn: ({ signal }) => notesApi.search(term, signal),
    select: hidePending,
    placeholderData: keepPreviousData,
    refetchInterval: REFETCH_INTERVAL_MS,
  })
}

function findInLists(queryClient: QueryClient, id: string): Note | undefined {
  for (const [, notes] of queryClient.getQueriesData<Note[]>({ queryKey: noteKeys.lists() })) {
    const found = notes?.find((n) => n.id === id)
    if (found) return found
  }
  return undefined
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
 * runs. On success it is removed from every cached list; on failure it comes
 * back on its own, with an error toast.
 */
export function useDeleteNote() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationKey: deleteNoteKey,
    mutationFn: deleteNote,
    onSuccess: (_data, id) => {
      queryClient.setQueriesData<Note[]>({ queryKey: noteKeys.lists() }, (notes) => notes?.filter((n) => n.id !== id))
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
