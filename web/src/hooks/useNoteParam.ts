import { useCallback, useSyncExternalStore } from 'react'

// Keeps the selected note in the URL (?note=<id>) without a router, so a note
// can be linked to and the browser's Back button returns to the list.

const PARAM = 'note'
const listeners = new Set<() => void>()

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  window.addEventListener('popstate', onChange)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('popstate', onChange)
  }
}

function getNoteId(): string | null {
  return new URLSearchParams(window.location.search).get(PARAM) || null
}

export function useNoteParam(): [noteId: string | null, setNoteId: (id: string | null) => void] {
  const noteId = useSyncExternalStore(subscribe, getNoteId)

  const setNoteId = useCallback((id: string | null) => {
    if (id === getNoteId()) return
    const url = new URL(window.location.href)
    if (id) {
      url.searchParams.set(PARAM, id)
    } else {
      url.searchParams.delete(PARAM)
    }
    window.history.pushState(null, '', url)
    for (const listener of listeners) listener()
  }, [])

  return [noteId, setNoteId]
}
