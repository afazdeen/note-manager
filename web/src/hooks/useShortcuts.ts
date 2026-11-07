import { useEffect, useRef } from 'react'

export type Shortcuts = Partial<Record<string, (event: KeyboardEvent) => void>>

/** True when the key press is meant for a text field, so single-key shortcuts must not fire. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/**
 * Global single-key shortcuts, keyed by KeyboardEvent.key (e.g. "/").
 * They don't fire while typing in a field or with Ctrl, Cmd or Alt held.
 */
export function useShortcuts(shortcuts: Shortcuts): void {
  const latest = useRef(shortcuts)
  useEffect(() => {
    latest.current = shortcuts
  })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) {
        return
      }
      const handler = latest.current[event.key]
      if (handler) {
        event.preventDefault()
        handler(event)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])
}
