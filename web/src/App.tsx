import { useRef, useState } from 'react'
import { useNotesSearch } from './api/notes'
import { buttonStyles } from './components/buttonStyles'
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

  useShortcuts({
    '/': () => {
      searchRef.current?.focus()
      searchRef.current?.select()
    },
  })

  const openNote = (id: string) => {
    setNoteId(id)
    // On mobile the list is hidden once a note opens, so move focus to the note.
    if (!isDesktop) requestAnimationFrame(() => detailRef.current?.focus())
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
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
          <h1 className="text-lg font-semibold tracking-tight">Team Notes</h1>
          <SearchBar
            value={search}
            onChange={setSearch}
            inputRef={searchRef}
            busy={notesQuery.isFetching && notesQuery.isPlaceholderData}
            className="order-last w-full md:order-none md:w-auto md:max-w-md md:flex-1"
          />
          <button type="button" disabled title="Coming soon" className={`${buttonStyles.primary} ml-auto`}>
            New note
          </button>
        </div>
        <div aria-hidden="true" className="h-1 bg-gradient-brand" />
      </header>

      <main id="main" tabIndex={-1} className="flex min-h-0 flex-1 md:grid md:grid-cols-[22.5rem_1fr]">
        <section
          aria-label="Note list"
          className={`min-h-0 w-full flex-col border-border bg-surface md:flex md:border-r ${noteId ? 'hidden' : 'flex'}`}
        >
          <div className="min-h-0 flex-1 overflow-y-auto">
            <NoteList
              query={notesQuery}
              search={activeSearch}
              selectedId={noteId}
              onSelect={openNote}
              onClearSearch={() => setSearch('')}
            />
          </div>
          <p className="hidden border-t border-border px-4 py-2 text-xs text-ink-muted md:block">
            <Kbd>/</Kbd> search · <Kbd>↑</Kbd> <Kbd>↓</Kbd> move · <Kbd>Enter</Kbd> open
          </p>
        </section>

        <section
          ref={detailRef}
          tabIndex={-1}
          aria-label="Note details"
          className={`min-h-0 w-full overflow-y-auto md:block ${noteId ? 'block' : 'hidden'}`}
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
          <NoteDetail noteId={noteId} onClose={backToList} />
        </section>
      </main>
    </div>
  )
}

function Kbd({ children }: Readonly<{ children: string }>) {
  return <kbd className="rounded border border-border bg-bg px-1 font-sans">{children}</kbd>
}
