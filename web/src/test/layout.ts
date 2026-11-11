// jsdom has no layout: every element is 0 px tall and elements can't scroll,
// so the virtual note list would render no rows. These stubs give the list's
// scroll area (data-note-scroller) a height and a content height (the virtual
// <ul>'s inline height), give each virtual row (data-index) a fixed height,
// and make element.scrollTo() move scrollTop and fire "scroll". The
// virtualizer reads exactly these: clientHeight, scrollHeight, offsetHeight
// and scrollTop. The setup file installs them once and resets the height
// after each test.

/** Height of every virtual row in tests, in px. */
export const ROW_HEIGHT = 96
/** Default height of the list's scroll area: tall enough to show every seed note. */
const DEFAULT_LIST_HEIGHT = 800

let listHeight = DEFAULT_LIST_HEIGHT

/** Sets the visible height of the note list for the current test, e.g. 2 rows' worth. */
export function setListHeight(px: number): void {
  listHeight = px
}

export function resetLayout(): void {
  listHeight = DEFAULT_LIST_HEIGHT
}

/** The note list's scroll area. */
export function listScroller(): HTMLElement {
  const scroller = document.querySelector<HTMLElement>('[data-note-scroller]')
  if (!scroller) throw new Error('The note list scroll area is not rendered')
  return scroller
}

/** Scrolls the note list to `top` px, as the user would. */
export function scrollListTo(top: number): void {
  listScroller().scrollTo({ top })
}

export function installLayoutStubs(): void {
  const clientHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight')
  const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')

  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement): number {
      if (this.hasAttribute('data-note-scroller')) return listHeight
      return Number(clientHeight?.get?.call(this) ?? 0)
    },
  })
  const scrollHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight')
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get(this: HTMLElement): number {
      if (this.hasAttribute('data-note-scroller')) {
        // The virtual <ul> sets its full height inline; the scroll area is at least as tall as its view.
        const content = Number.parseFloat(this.querySelector('ul')?.style.height ?? '') || 0
        return Math.max(content, listHeight)
      }
      return Number(scrollHeight?.get?.call(this) ?? 0)
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement): number {
      if (this.hasAttribute('data-index')) return ROW_HEIGHT
      return Number(offsetHeight?.get?.call(this) ?? 0)
    },
  })
  // jsdom only has window.scrollTo (and it isn't implemented).
  Object.defineProperty(Element.prototype, 'scrollTo', {
    configurable: true,
    writable: true,
    value(this: Element, options?: ScrollToOptions | number, y?: number): void {
      const top = typeof options === 'number' ? (y ?? 0) : (options?.top ?? this.scrollTop)
      this.scrollTop = Math.max(0, top)
      this.dispatchEvent(new Event('scroll'))
    },
  })
}
