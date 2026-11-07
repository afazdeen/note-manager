import { useEffect, useRef } from 'react'

export type Shortcuts = Partial<Record<string, (event: KeyboardEvent) => void>>

/**
 * True when the key press is meant for a text field, so single-key shortcuts
 * must not fire. Uses composedPath() to see the real target inside shadow DOM
 * (e.g. the input inside <tag-input>), not just the host element.
 */
function isTyping(event: KeyboardEvent): boolean {
  const target = event.composedPath()[0] ?? event.target
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
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || isTyping(event)) {
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
