import { useNote } from '../api/notes'
import type { Note } from '../api/types'
import { formatFullDate } from '../lib/format'
import { TagInput } from '../web-components/tag-input/TagInput'
import { buttonStyles } from './buttonStyles'
import { EmptyState } from './EmptyState'
import { ErrorState } from './ErrorState'
import { TrashIcon } from './icons'
import { Skeleton } from './Skeleton'

/** The open note sits in a light purple card; the loading skeleton uses the same shape. */
const cardWrap = 'p-4 md:p-6 lg:p-8'
const card = 'mx-auto max-w-3xl rounded-2xl border border-purple-100 bg-purple-50 p-5 md:p-8'

interface NoteDetailProps {
  noteId: string | null
  onClose: () => void
  /** Called when a tag is clicked, to search for it. */
  onTagClick: (tag: string) => void
  onDelete: (note: Note) => void
}

export function NoteDetail({ noteId, onClose, onTagClick, onDelete }: Readonly<NoteDetailProps>) {
  const { data: note, isError, error, refetch, isFetching } = useNote(noteId ?? undefined)

  if (!noteId) {
    return <EmptyState title="Select a note" description="Choose a note from the list, or press N to create one." />
  }

  // Not found wins over cached data: the note may have just been deleted by an agent.
  if (isError && error.code === 'not_found') {
    return (
      <EmptyState
        title="Note not found"
        description="It may have been deleted, possibly by an agent."
        action={
          <button type="button" onClick={onClose} className={buttonStyles.secondary}>
            Back to notes
          </button>
        }
      />
    )
  }

  if (note) {
    return (
      <div className={cardWrap}>
        <article className={card}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-2xl font-semibold tracking-tight break-words text-ink">{note.title}</h2>
              <p className="mt-1 text-sm text-ink-muted">
                Created <time dateTime={note.createdAt}>{formatFullDate(note.createdAt)}</time>
              </p>
            </div>
            <button
              type="button"
              onClick={() => onDelete(note)}
              aria-keyshortcuts="Delete"
              className={`${buttonStyles.dangerSubtle} shrink-0`}
            >
              <TrashIcon />
              Delete
            </button>
          </div>
          {note.tags.length > 0 && (
            <TagInput label="Tags" tags={note.tags} readOnly onTagClick={onTagClick} className="mt-4" />
          )}
          {note.body ? (
            <p className="mt-6 leading-relaxed break-words whitespace-pre-wrap text-ink">{note.body}</p>
          ) : (
            <p className="mt-6 text-ink-muted italic">This note has no body.</p>
          )}
        </article>
      </div>
    )
  }

  if (isError) {
    return (
      <ErrorState
        title="Couldn't load this note"
        message={error.message}
        onRetry={() => void refetch()}
        retrying={isFetching}
      />
    )
  }

  return <NoteDetailSkeleton />
}

function NoteDetailSkeleton() {
  return (
    <div className={cardWrap}>
      <div aria-busy="true" className={`${card} space-y-3`}>
        <p className="sr-only">Loading note…</p>
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-4 w-40" />
        <div className="space-y-2 pt-4">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    </div>
  )
}
