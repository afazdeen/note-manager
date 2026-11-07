import {
  keepPreviousData,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { useToast } from '../components/toast/toast-context'
import { notesApi, type ApiError } from './client'
import type { Note } from './types'

/** How often lists refetch, so notes changed by agents over MCP show up. */
const LIST_REFETCH_INTERVAL_MS = 15_000

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

/**
 * Notes matching `search` (all notes when empty), newest first. While a new
 * search loads, the previous results stay in `data` and `isPlaceholderData` is true.
 */
export function useNotesSearch(search: string) {
  const term = normalizeSearch(search)
  return useQuery({
    queryKey: noteKeys.list(term),
    queryFn: ({ signal }) => notesApi.search(term, signal),
    placeholderData: keepPreviousData,
    refetchInterval: LIST_REFETCH_INTERVAL_MS,
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

/** One note. Shows the copy from a loaded list at once while the fresh one loads. */
export function useNote(id: string | undefined) {
  const queryClient = useQueryClient()
  // Explicit types: otherwise TypeScript infers the data type from placeholderData.
  return useQuery<Note, ApiError, Note, NoteDetailKey>({
    queryKey: noteKeys.detail(id ?? ''),
    queryFn: id === undefined ? skipToken : ({ signal }) => notesApi.get(id, signal),
    placeholderData: () => (id === undefined ? undefined : findInLists(queryClient, id)),
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
    onSuccess: async (note) => {
      queryClient.setQueryData(noteKeys.detail(note.id), note)
      toast.success('Note created')
      await queryClient.invalidateQueries({ queryKey: noteKeys.lists() })
    },
  })
}

/**
 * Deletes a note optimistically: it leaves every cached list at once, and
 * comes back with an error toast if the request fails.
 */
export function useDeleteNote() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (id: string) => notesApi.delete(id),
    onMutate: async (id) => {
      // Stop in-flight list fetches so they can't overwrite the optimistic update.
      await queryClient.cancelQueries({ queryKey: noteKeys.lists() })
      const previousLists = queryClient.getQueriesData<Note[]>({ queryKey: noteKeys.lists() })
      queryClient.setQueriesData<Note[]>({ queryKey: noteKeys.lists() }, (notes) =>
        notes?.filter((n) => n.id !== id),
      )
      return { previousLists }
    },
    onError: (error, _id, context) => {
      for (const [key, notes] of context?.previousLists ?? []) {
        queryClient.setQueryData(key, notes)
      }
      toast.error(`Couldn't delete the note. ${error.message}`)
    },
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: noteKeys.detail(id) })
      toast.success('Note deleted')
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: noteKeys.lists() }),
  })
}
