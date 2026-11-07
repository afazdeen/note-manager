import { useCallback, useSyncExternalStore } from 'react'

/** Whether `query` matches. Returns `fallback` where matchMedia is missing (e.g. jsdom). */
export function useMediaQuery(query: string, fallback = true): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window.matchMedia !== 'function') return () => undefined
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    [query],
  )

  return useSyncExternalStore(subscribe, () =>
    typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : fallback,
  )
}
