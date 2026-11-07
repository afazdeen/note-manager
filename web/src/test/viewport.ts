// jsdom has no matchMedia, so useMediaQuery falls back to the desktop layout.
// Call setViewportWidth(375) before rendering to test the phone layout; the
// setup file removes the stub after each test.

/** Answers min-width and max-width queries (in px) as a screen `width` px wide would. */
export function setViewportWidth(width: number): void {
  const matches = (query: string): boolean => {
    const min = /min-width:\s*(\d+)px/.exec(query)
    const max = /max-width:\s*(\d+)px/.exec(query)
    return (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]))
  }
  const matchMedia = (query: string): MediaQueryList => ({
    matches: matches(query),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })
  Object.defineProperty(window, 'matchMedia', { value: matchMedia, configurable: true, writable: true })
}

export function resetViewport(): void {
  Reflect.deleteProperty(window, 'matchMedia')
}
