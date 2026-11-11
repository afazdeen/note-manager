import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import type { NotesQuery } from '../api/notes'
import type { Note } from '../api/types'
import { formatRelativeDate } from '../lib/format'
import { buttonStyles } from './buttonStyles'
import { EmptyState } from './EmptyState'
import { ErrorState } from './ErrorState'
import { TrashIcon } from './icons'
import { Skeleton } from './Skeleton'
import { TagChips } from './TagChips'

/** Starting guess for a row's height in px; every rendered row is then measured. */
const ESTIMATED_ROW_HEIGHT = 96
/** Rows rendered above and below the visible ones. */
const OVERSCAN = 4
/** Load the next page once the last visible row is within this many rows of the end. */
const LOAD_AHEAD_ROWS = 1

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

/**
 * The note list pane: a refetch error banner, then a scroll area holding the
 * loading skeleton, an empty state or the virtual list of notes.
 */
export function NoteList({
  query,
  search,
  selectedId,
  onSelect,
  onDelete,
  onClearSearch,
  onCreateNote,
}: Readonly<NoteListProps>) {
  const { data, isPending, isError, isFetchNextPageError, error, refetch, isFetching } = query
  const scrollRef = useRef<HTMLDivElement>(null)
  const notes = data?.notes

  return (
    <>
      {/* A failed next page is shown at the end of the list instead, next to where it would have loaded. */}
      {isError && !isFetchNextPageError && (
        <div className="shrink-0">
          <ErrorState
            title="Couldn't load notes"
            message={error.message}
            onRetry={() => void refetch()}
            retrying={isFetching}
          />
        </div>
      )}
      {/* data-note-scroller: the test layout stubs give this element its height. */}
      <div ref={scrollRef} data-note-scroller="" className="min-h-0 flex-1 overflow-y-auto">
        {isPending && <NoteListSkeleton />}
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
            query={query}
            notes={notes}
            total={data.total}
            scrollRef={scrollRef}
            selectedId={selectedId}
            onSelect={onSelect}
            onDelete={onDelete}
          />
        )}
      </div>
      {data && (
        <p aria-live="polite" className="sr-only">
          {data.total === 1 ? '1 note' : `${data.total} notes`}
        </p>
      )}
    </>
  )
}

interface NoteRowsProps {
  query: NotesQuery
  notes: Note[]
  /** How many notes match in total, including pages not loaded yet. */
  total: number
  scrollRef: RefObject<HTMLDivElement | null>
  selectedId: string | null
  onSelect: (id: string) => void
  onDelete: (note: Note) => void
}

/**
 * The virtual list. Only the rows in view (plus OVERSCAN above and below) are
 * in the DOM, positioned inside a <ul> as tall as every loaded row. The next
 * page loads as the end comes into view.
 *
 * Some rows always stay mounted, even when scrolled away: the list's Tab stop
 * and its neighbours, and the selected row. So the focused row is never
 * unmounted (focus would be lost), Tab can always reach the list, ↑/↓ always
 * have a row to move to, and the App can focus the next note after a delete
 * or the open note's row after Back.
 */
function NoteRows({ query, notes, total, scrollRef, selectedId, onSelect, onDelete }: Readonly<NoteRowsProps>) {
  const { isPlaceholderData, hasNextPage, isFetching, isFetchingNextPage, isFetchNextPageError, error, fetchNextPage } =
    query
  const listRef = useRef<HTMLUListElement>(null)
  const idPrefix = useId()
  // The row that last had focus. With the selected note and the first row as
  // fallbacks, it is the list's single Tab stop (plus that row's delete button).
  const [activeId, setActiveId] = useState<string | null>(null)
  const has = (id: string | null): id is string => id !== null && notes.some((n) => n.id === id)
  const tabStopId = (has(activeId) && activeId) || (has(selectedId) && selectedId) || notes[0]?.id
  const indexOf = (id: string | null | undefined): number => notes.findIndex((n) => n.id === id)

  // Rows that stay mounted whatever the scroll position (see above). A string,
  // so the range extractor only changes when they do.
  const tabStopIndex = indexOf(tabStopId)
  const pinnedKey = [tabStopIndex - 1, tabStopIndex, tabStopIndex + 1, indexOf(selectedId)]
    .filter((i) => i >= 0 && i < notes.length)
    .join(',')
  const rangeExtractor = useCallback(
    (range: Range): number[] => {
      const pinned = pinnedKey === '' ? [] : pinnedKey.split(',').map(Number)
      return [...new Set([...defaultRangeExtractor(range), ...pinned])].sort((a, b) => a - b)
    },
    [pinnedKey],
  )

  // The React Compiler can't memoize useVirtualizer's results, so it would skip
  // this component. This project doesn't use the compiler.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: notes.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: OVERSCAN,
    getItemKey: (index) => notes[index]?.id ?? index,
    rangeExtractor,
  })
  const items = virtualizer.getVirtualItems()
  // The rows actually in view (no overscan or pinned rows), set by getVirtualItems.
  const lastVisibleIndex = virtualizer.range?.endIndex

  // Infinite scroll. Waits while anything is fetching, because fetchNextPage
  // would cancel a running refetch, and after a failed page (Retry loads it).
  useEffect(() => {
    if (lastVisibleIndex === undefined || lastVisibleIndex < notes.length - 1 - LOAD_AHEAD_ROWS) return
    if (hasNextPage && !isFetching && !isFetchNextPageError) void fetchNextPage()
  }, [lastVisibleIndex, notes.length, hasNextPage, isFetching, isFetchNextPageError, fetchNextPage])

  const rowButton = (id: string): HTMLButtonElement | null =>
    listRef.current?.querySelector<HTMLButtonElement>(`button[data-note-id="${CSS.escape(id)}"]`) ?? null

  // A row to focus once it has been rendered (Home/End to a row that was scrolled away).
  const pendingFocusId = useRef<string | null>(null)
  useLayoutEffect(() => {
    const id = pendingFocusId.current
    const button = id === null ? null : rowButton(id)
    if (button) {
      pendingFocusId.current = null
      button.focus({ preventScroll: true })
    }
  })

  /** Scrolls the row at `index` into view and focuses it, rendering it first if needed. */
  const focusRow = (index: number) => {
    const id = notes[index]?.id
    if (id === undefined) return
    virtualizer.scrollToIndex(index)
    const button = rowButton(id)
    if (button) {
      button.focus({ preventScroll: true })
      return
    }
    // Making it the Tab stop pins it, so the next render mounts it and the layout effect focuses it.
    pendingFocusId.current = id
    setActiveId(id)
  }

  // Moves by position in the loaded notes, not by rows in the DOM: most rows aren't rendered.
  const onRowKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const targets: Partial<Record<string, number>> = {
      ArrowDown: Math.min(index + 1, notes.length - 1),
      ArrowUp: Math.max(index - 1, 0),
      Home: 0,
      End: notes.length - 1,
    }
    const next = targets[event.key]
    if (next === undefined) return

    event.preventDefault()
    focusRow(next)
  }

  return (
    <>
      <ul
        ref={listRef}
        aria-label="Notes"
        aria-busy={isPlaceholderData}
        className={`relative transition-opacity ${isPlaceholderData ? 'opacity-60' : ''}`}
        style={{ height: virtualizer.getTotalSize() }}
      >
        {items.map((item) => {
          const note = notes[item.index]
          if (!note) return null
          const selected = note.id === selectedId
          const tabbable = note.id === tabStopId
          const titleId = `${idPrefix}-${note.id}-title`
          const dateId = `${idPrefix}-${note.id}-date`
          const metaId = `${idPrefix}-${note.id}-meta`
          return (
            // data-note-row lets the Delete key find the note from the row or its delete button.
            // data-index tells the virtualizer which row it is measuring.
            <li
              key={item.key}
              ref={virtualizer.measureElement}
              data-index={item.index}
              data-note-row={note.id}
              aria-setsize={total}
              aria-posinset={item.index + 1}
              className={`group absolute top-0 left-0 w-full ${item.index > 0 ? 'border-t border-border' : ''}`}
              style={{ transform: `translateY(${item.start}px)` }}
            >
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
                onKeyDown={(event) => onRowKeyDown(event, item.index)}
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
      {isFetchingNextPage && (
        <div aria-busy="true" className="border-t border-border">
          <p className="sr-only">Loading more notes…</p>
          <SkeletonRow />
        </div>
      )}
      {isFetchNextPageError && !isFetchingNextPage && (
        <ErrorState
          title="Couldn't load more notes"
          message={error.message}
          onRetry={() => void fetchNextPage()}
        />
      )}
    </>
  )
}

function SkeletonRow() {
  return (
    <div className="space-y-2 px-5 py-4">
      <div className="flex justify-between gap-4">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-12" />
      </div>
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-4/5" />
    </div>
  )
}

function NoteListSkeleton() {
  return (
    <div aria-busy="true" className="divide-y divide-border">
      <p className="sr-only">Loading notes…</p>
      {[0, 1, 2, 3].map((i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  )
}
