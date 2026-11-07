import type { UseQueryResult } from '@tanstack/react-query'
import { useId, useRef, type KeyboardEvent } from 'react'
import type { ApiError } from '../api/client'
import type { Note } from '../api/types'
import { formatRelativeDate } from '../lib/format'
import { buttonStyles } from './buttonStyles'
import { EmptyState } from './EmptyState'
import { ErrorState } from './ErrorState'
import { Skeleton } from './Skeleton'
import { TagChips } from './TagChips'

interface NoteListProps {
  query: UseQueryResult<Note[], ApiError>
  /** The search the results are for, used in the "no results" message. */
  search: string
  selectedId: string | null
  onSelect: (id: string) => void
  onClearSearch: () => void
}

export function NoteList({ query, search, selectedId, onSelect, onClearSearch }: Readonly<NoteListProps>) {
  const { data: notes, isPending, isError, error, refetch, isFetching, isPlaceholderData } = query

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
          <EmptyState title="No notes yet" description="Notes you and your agents create will show up here." />
        ))}
      {notes && notes.length > 0 && (
        <NoteRows notes={notes} selectedId={selectedId} onSelect={onSelect} stale={isPlaceholderData} />
      )}
      {notes && (
        <p aria-live="polite" className="sr-only">
          {notes.length === 1 ? '1 note' : `${notes.length} notes`}
        </p>
      )}
    </>
  )
}

interface NoteRowsProps {
  notes: Note[]
  selectedId: string | null
  onSelect: (id: string) => void
  /** True while showing old results during a new search. */
  stale: boolean
}

function NoteRows({ notes, selectedId, onSelect, stale }: Readonly<NoteRowsProps>) {
  const listRef = useRef<HTMLUListElement>(null)
  const idPrefix = useId()
  // One tab stop for the whole list (the selected note, or the first); arrows move within it.
  const tabStopId = notes.some((n) => n.id === selectedId) ? selectedId : notes[0]?.id

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
        const titleId = `${idPrefix}-${note.id}-title`
        const metaId = `${idPrefix}-${note.id}-meta`
        return (
          <li key={note.id}>
            <button
              type="button"
              data-note-id={note.id}
              tabIndex={note.id === tabStopId ? 0 : -1}
              aria-current={selected ? 'true' : undefined}
              aria-labelledby={titleId}
              aria-describedby={metaId}
              onClick={() => onSelect(note.id)}
              onKeyDown={onRowKeyDown}
              className={`block w-full border-l-4 px-4 py-3 text-left hover:bg-purple-50 focus-visible:-outline-offset-2 ${
                selected ? 'border-purple-500 bg-purple-50' : 'border-transparent'
              }`}
            >
              <span className="flex items-baseline justify-between gap-3">
                <span id={titleId} className="truncate font-medium text-ink">
                  {note.title}
                </span>
                <time dateTime={note.createdAt} className="shrink-0 text-xs text-ink-muted">
                  {formatRelativeDate(note.createdAt)}
                </time>
              </span>
              {note.body && <span className="mt-1 line-clamp-2 text-sm text-ink-muted">{note.body}</span>}
              <span id={metaId}>
                <TagChips tags={note.tags} className="mt-2" />
              </span>
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
