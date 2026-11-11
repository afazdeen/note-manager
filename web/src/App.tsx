import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { noteKeys, useDeleteNote, useNotesSearch } from './api/notes'
import type { Note } from './api/types'
import { buttonStyles } from './components/buttonStyles'
import { ConfirmDialog } from './components/ConfirmDialog'
import { CreateNoteDialog } from './components/CreateNoteForm'
import { NoteDetail } from './components/NoteDetail'
import { NoteList } from './components/NoteList'
import { SearchBar } from './components/SearchBar'
import { useDebouncedValue } from './hooks/useDebouncedValue'
import { useMediaQuery } from './hooks/useMediaQuery'
import { useNoteParam } from './hooks/useNoteParam'
import { useShortcuts } from './hooks/useShortcuts'

const SEARCH_DEBOUNCE_MS = 250

export function App() {
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search, SEARCH_DEBOUNCE_MS)
  // Clearing the search shows every note at once; typing waits for a pause.
  const activeSearch = search.trim() === '' ? '' : debounced.trim()
  const notesQuery = useNotesSearch(activeSearch)

  const [noteId, setNoteId] = useNoteParam()
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const searchRef = useRef<HTMLInputElement>(null)
  const detailRef = useRef<HTMLElement>(null)
  const newNoteRef = useRef<HTMLButtonElement>(null)
  const [creating, setCreating] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState<Note | null>(null)
  const queryClient = useQueryClient()
  const deleteNote = useDeleteNote()

  // The latest selection, for callbacks that run after a request finishes.
  const noteIdRef = useRef(noteId)
  useEffect(() => {
    noteIdRef.current = noteId
  })

  const findNote = (id: string): Note | undefined =>
    notesQuery.data?.notes.find((n) => n.id === id) ?? queryClient.getQueryData<Note>(noteKeys.detail(id))

  /** The note to select after `id` is deleted: the next loaded one in the list, else the previous one. */
  const neighbourOf = (id: string): string | null => {
    const notes = notesQuery.data?.notes ?? []
    const i = notes.findIndex((n) => n.id === id)
    if (i === -1) return null
    return notes[i + 1]?.id ?? notes[i - 1]?.id ?? null
  }

  /** Delete key: the note of the focused list row (its row or delete button), otherwise the open note. */
  const deleteFocusedOrOpenNote = () => {
    const row = document.activeElement?.closest<HTMLElement>('[data-note-row]')
    const id = row?.dataset.noteRow ?? noteId
    const note = id ? findNote(id) : undefined
    if (note) setConfirmingDelete(note)
  }

  const dialogOpen = creating || confirmingDelete !== null

  // Page shortcuts are off while a dialog is open; dialogs have their own keys.
  useShortcuts(
    dialogOpen
      ? {}
      : {
          '/': () => {
            searchRef.current?.focus()
            searchRef.current?.select()
          },
          n: () => setCreating(true),
          Delete: deleteFocusedOrOpenNote,
          // Mac keyboards label Backspace "delete".
          Backspace: deleteFocusedOrOpenNote,
        },
  )

  const confirmDelete = () => {
    const note = confirmingDelete
    if (!note) return
    setConfirmingDelete(null)

    const wasOpen = noteId === note.id
    const nextId = neighbourOf(note.id)
    // Replace, not push: the browser's Back button shouldn't lead to the deleted note.
    if (wasOpen) setNoteId(nextId, { replace: true })

    // The list drops the note at once (optimistic); if the server fails it comes back.
    deleteNote.mutate(note.id, {
      onError: () => {
        // Re-select it too, unless the user has moved on since.
        if (wasOpen && noteIdRef.current === nextId) setNoteId(note.id, { replace: true })
      },
    })

    // The row or button that had focus is going away, so move focus to what's selected now.
    requestAnimationFrame(() => {
      if (!isDesktop && wasOpen && nextId) {
        detailRef.current?.focus()
        return
      }
      const row = nextId ? document.querySelector<HTMLElement>(`[data-note-id="${CSS.escape(nextId)}"]`) : null
      ;(row ?? newNoteRef.current)?.focus()
    })
  }

  const onCreated = (note: Note) => {
    setCreating(false)
    setNoteId(note.id)
  }

  const openNote = (id: string) => {
    setNoteId(id)
    // On mobile the list is hidden once a note opens, so move focus to the note.
    if (!isDesktop) requestAnimationFrame(() => detailRef.current?.focus())
  }

  // Clicking a tag in a note searches for it. On mobile, go back to the list to
  // show the results, and move focus to the search box, since the tag that had
  // focus is hidden with the note.
  const searchForTag = (tag: string) => {
    setSearch(tag)
    if (!isDesktop) {
      setNoteId(null)
      requestAnimationFrame(() => searchRef.current?.focus())
    }
  }

  const backToList = () => {
    const previous = noteId
    setNoteId(null)
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-note-id="${CSS.escape(previous ?? '')}"]`)?.focus()
    })
  }

  return (
    <div className="flex h-dvh flex-col bg-bg text-ink">
      <a
        href="#main"
        className="sr-only rounded-md bg-purple-600 px-3 py-2 text-white focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50"
      >
        Skip to content
      </a>

      <header>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-4 px-4 py-3 md:gap-x-10">
          <h1 className="text-lg font-semibold tracking-tight">Team Notes</h1>
          <SearchBar
            value={search}
            onChange={setSearch}
            inputRef={searchRef}
            busy={notesQuery.isFetching && notesQuery.isPlaceholderData}
            className="order-last w-full md:order-none md:w-auto md:max-w-md md:flex-1"
          />
          <button
            ref={newNoteRef}
            type="button"
            onClick={() => setCreating(true)}
            aria-keyshortcuts="n"
            className={`${buttonStyles.primary} ml-auto`}
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4" fill="currentColor">
              <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
            </svg>
            New note
          </button>
        </div>
        <div aria-hidden="true" className="h-1 bg-gradient-brand" />
      </header>

      {/* tabIndex -1: focus target for the skip link only, so no ring around the whole page. */}
      <main
        id="main"
        tabIndex={-1}
        className="flex min-h-0 flex-1 focus:outline-hidden md:grid md:grid-cols-[22.5rem_1fr] lg:grid-cols-[26rem_1fr]"
      >
        <section
          aria-label="Note list"
          className={`min-h-0 w-full flex-col border-border bg-surface md:flex md:border-r ${noteId ? 'hidden' : 'flex'}`}
        >
          {/* NoteList owns the scroll area: the virtual list measures it. */}
          <NoteList
            query={notesQuery}
            search={activeSearch}
            selectedId={noteId}
            onSelect={openNote}
            onDelete={setConfirmingDelete}
            onClearSearch={() => setSearch('')}
            onCreateNote={() => setCreating(true)}
          />
          <ShortcutsHint />
        </section>

        <section
          ref={detailRef}
          tabIndex={-1}
          aria-label="Note details"
          className={`min-h-0 w-full overflow-y-auto focus:outline-hidden md:block ${noteId ? 'block' : 'hidden'}`}
        >
          {noteId && (
            <div className="border-b border-border px-2 py-2 md:hidden">
              <button type="button" onClick={backToList} className={buttonStyles.ghost}>
                <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z"
                    clipRule="evenodd"
                  />
                </svg>
                Back
              </button>
            </div>
          )}
          <NoteDetail
            noteId={noteId}
            onClose={backToList}
            onTagClick={searchForTag}
            onDelete={setConfirmingDelete}
          />
        </section>
      </main>

      {creating && (
        <CreateNoteDialog onCancel={() => setCreating(false)} onCreated={onCreated} returnFocusRef={newNoteRef} />
      )}
      {confirmingDelete && (
        <ConfirmDialog
          title="Delete this note?"
          description={`"${confirmingDelete.title}" will be deleted for everyone, including agents. This can't be undone.`}
          confirmLabel="Delete note"
          onConfirm={confirmDelete}
          onCancel={() => setConfirmingDelete(null)}
        />
      )}
    </div>
  )
}

/** Desktop-only hint; phones rarely have a keyboard. */
function ShortcutsHint() {
  const shortcuts: [keys: string[], action: string][] = [
    [['N'], 'new'],
    [['/'], 'search'],
    [['↑', '↓'], 'move'],
    [['Enter'], 'open'],
    [['Del'], 'delete'],
  ]
  return (
    <p className="hidden flex-wrap gap-x-2.5 gap-y-1 border-t border-border px-3 py-2 text-xs text-ink-muted md:flex">
      <span className="sr-only">Keyboard shortcuts:</span>
      {shortcuts.map(([keys, action]) => (
        <span key={action} className="whitespace-nowrap">
          {keys.map((key) => (
            <kbd key={key} className="mr-0.5 rounded border border-border bg-bg px-1 font-sans">
              {key}
            </kbd>
          ))}{' '}
          {action}
        </span>
      ))}
    </p>
  )
}
