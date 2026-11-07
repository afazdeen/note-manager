import { useNote } from '../api/notes'
import { formatFullDate } from '../lib/format'
import { buttonStyles } from './buttonStyles'
import { EmptyState } from './EmptyState'
import { ErrorState } from './ErrorState'
import { Skeleton } from './Skeleton'
import { TagChips } from './TagChips'

interface NoteDetailProps {
  noteId: string | null
  onClose: () => void
}

export function NoteDetail({ noteId, onClose }: Readonly<NoteDetailProps>) {
  const { data: note, isError, error, refetch, isFetching } = useNote(noteId ?? undefined)

  if (!noteId) {
    return <EmptyState title="Select a note" description="Choose a note from the list to read it here." />
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
      <article className="mx-auto max-w-3xl px-4 py-6 md:px-8">
        <h2 className="text-2xl font-semibold tracking-tight break-words text-ink">{note.title}</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Created <time dateTime={note.createdAt}>{formatFullDate(note.createdAt)}</time>
        </p>
        <TagChips tags={note.tags} className="mt-3" />
        {note.body ? (
          <p className="mt-6 leading-relaxed break-words whitespace-pre-wrap text-ink">{note.body}</p>
        ) : (
          <p className="mt-6 text-ink-muted italic">This note has no body.</p>
        )}
      </article>
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
    <div aria-busy="true" className="mx-auto max-w-3xl space-y-3 px-4 py-6 md:px-8">
      <p className="sr-only">Loading note…</p>
      <Skeleton className="h-7 w-2/3" />
      <Skeleton className="h-4 w-40" />
      <div className="space-y-2 pt-4">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </div>
  )
}
