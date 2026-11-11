import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import type { NotesQuery } from '../api/notes'
import type { Note } from '../api/types'
import { formatRelativeDate } from '../lib/format'
import { buttonStyles } from './buttonStyles'
import { EmptyState } from './EmptyState'
import { ErrorState } from './ErrorState'
import { TrashIcon } from './icons'
import { Skeleton } from './Skeleton'
import { TagChips } from './TagChips'

interface NoteListProps {
  query: NotesQuery
  /** The search the results are for, used in the "no results" message. */
  search: string
  selectedId: string | null
  onSelect: (id: string) => void
  onDelete: (note: Note) => void
  onClearSearch: () => void
  onCreateNote: () => void
}

export function NoteList({
  query,
  search,
  selectedId,
  onSelect,
  onDelete,
  onClearSearch,
  onCreateNote,
}: Readonly<NoteListProps>) {
  const { data, isPending, isError, error, refetch, isFetching, isPlaceholderData } = query
  const { hasNextPage, isFetchNextPageError, fetchNextPage } = query
  const notes = data?.notes

  // TEMPORARY until the virtual list (build step 9) loads pages as you scroll:
  // load the remaining pages one after another, so the whole list shows.
  // Waits while anything is fetching, because fetchNextPage would cancel a
  // running refetch, and stops after a failed page (Retry refetches).
  useEffect(() => {
    if (hasNextPage && !isFetching && !isFetchNextPageError) void fetchNextPage()
  }, [hasNextPage, isFetching, isFetchNextPageError, fetchNextPage])

  if (isPending) {
    return <NoteListSkeleton />
  }

  return (
    <>
      {isError && (
        <ErrorState
          title="Couldn't load notes"
          message={error.message}
          onRetry={() => void refetch()}
          retrying={isFetching}
        />
      )}
      {notes?.length === 0 &&
        (search ? (
          <EmptyState
            title={`No notes match "${search}"`}
            description="Try other words, or clear the search to see every note."
            action={
              <button type="button" onClick={onClearSearch} className={buttonStyles.secondary}>
                Clear search
              </button>
            }
          />
        ) : (
          <EmptyState
            title="No notes yet"
            description="Notes you and your agents create will show up here."
            action={
              <button type="button" onClick={onCreateNote} className={buttonStyles.primary}>
                Create your first note
              </button>
            }
          />
        ))}
      {notes && notes.length > 0 && (
        <NoteRows
          notes={notes}
          selectedId={selectedId}
          onSelect={onSelect}
          onDelete={onDelete}
          stale={isPlaceholderData}
        />
      )}
      {data && (
        <p aria-live="polite" className="sr-only">
          {data.total === 1 ? '1 note' : `${data.total} notes`}
        </p>
      )}
    </>
  )
}

interface NoteRowsProps {
  notes: Note[]
  selectedId: string | null
  onSelect: (id: string) => void
  onDelete: (note: Note) => void
  /** True while showing old results during a new search. */
  stale: boolean
}

function NoteRows({ notes, selectedId, onSelect, onDelete, stale }: Readonly<NoteRowsProps>) {
  const listRef = useRef<HTMLUListElement>(null)
  const idPrefix = useId()
  // The row that last had focus. With the selected note and the first row as
  // fallbacks, it is the list's single Tab stop (plus that row's delete button).
  const [activeId, setActiveId] = useState<string | null>(null)
  const has = (id: string | null): id is string => id !== null && notes.some((n) => n.id === id)
  const tabStopId = (has(activeId) && activeId) || (has(selectedId) && selectedId) || notes[0]?.id

  const onRowKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('button[data-note-id]') ?? [])
    const current = rows.indexOf(event.currentTarget)
    if (current === -1) return

    const targets: Partial<Record<string, number>> = {
      ArrowDown: Math.min(current + 1, rows.length - 1),
      ArrowUp: Math.max(current - 1, 0),
      Home: 0,
      End: rows.length - 1,
    }
    const next = targets[event.key]
    if (next === undefined) return

    event.preventDefault()
    rows[next]?.focus()
  }

  return (
    <ul
      ref={listRef}
      aria-label="Notes"
      aria-busy={stale}
      className={`divide-y divide-border transition-opacity ${stale ? 'opacity-60' : ''}`}
    >
      {notes.map((note) => {
        const selected = note.id === selectedId
        const tabbable = note.id === tabStopId
        const titleId = `${idPrefix}-${note.id}-title`
        const dateId = `${idPrefix}-${note.id}-date`
        const metaId = `${idPrefix}-${note.id}-meta`
        return (
          // data-note-row lets the Delete key find the note from the row or its delete button.
          <li key={note.id} data-note-row={note.id} className="group relative">
            <button
              type="button"
              data-note-id={note.id}
              tabIndex={tabbable ? 0 : -1}
              aria-current={selected ? 'true' : undefined}
              aria-labelledby={titleId}
              aria-describedby={`${dateId} ${metaId}`}
              aria-keyshortcuts="Delete"
              onClick={() => onSelect(note.id)}
              onFocus={() => setActiveId(note.id)}
              onKeyDown={onRowKeyDown}
              className={`block w-full border-l-4 py-3 pr-4 pl-4 text-left hover:bg-purple-50 focus-visible:-outline-offset-2 ${
                selected ? 'border-purple-500 bg-purple-50' : 'border-transparent'
              }`}
            >
              <span className="flex items-baseline justify-between gap-3">
                <span id={titleId} className="truncate font-medium text-ink">
                  {note.title}
                </span>
                <time id={dateId} dateTime={note.createdAt} className="shrink-0 text-xs text-ink-muted">
                  {formatRelativeDate(note.createdAt)}
                </time>
              </span>
              {note.body && <span className="mt-1 line-clamp-2 pr-8 text-sm text-ink-muted">{note.body}</span>}
              <span id={metaId} className="block min-h-6 pr-10">
                <TagChips tags={note.tags} className="mt-2" />
              </span>
            </button>
            {/* A sibling, not a child: buttons can't contain buttons. */}
            <button
              type="button"
              tabIndex={tabbable ? 0 : -1}
              aria-label={`Delete note ${note.title}`}
              aria-keyshortcuts="Delete"
              onClick={() => onDelete(note)}
              onFocus={() => setActiveId(note.id)}
              className="absolute right-2 bottom-2 grid size-8 place-items-center rounded-md text-ink-muted hover:bg-red-50 hover:text-red-600 focus-visible:bg-red-50 focus-visible:text-red-600"
            >
              <TrashIcon />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function NoteListSkeleton() {
  return (
    <div aria-busy="true" className="divide-y divide-border">
      <p className="sr-only">Loading notes…</p>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="space-y-2 px-5 py-4">
          <div className="flex justify-between gap-4">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-12" />
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
        </div>
      ))}
    </div>
  )
}
