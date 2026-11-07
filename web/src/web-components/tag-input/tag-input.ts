import { MAX_TAGS, cleanTags, normalizeTag, tagError } from './tag-rules'

/**
 * <tag-input>: a framework-free tag picker (Implementation_Guide.md section 8).
 *
 * Attributes: label, value (comma-separated), placeholder, max-tags, readonly, disabled,
 *             error (a message from the form, shown and announced like the element's own).
 * Property:   tags (string[]).
 * Events:     tags-change { tags } after the user changes the tags;
 *             tag-click { tag } when a chip is clicked in readonly mode.
 * Styling:    --tag-bg, --tag-fg, --tag-focus, ::part(label|field|chip|input).
 *
 * Colours come from the app's --color-* tokens, which CSS custom properties
 * carry into the shadow root.
 */

export interface TagsChangeDetail {
  tags: string[]
}

export interface TagClickDetail {
  tag: string
}

const styles = /* css */ `
  :host {
    --tag-bg: var(--color-purple-100);
    --tag-fg: var(--color-purple-700);
    --tag-focus: var(--color-purple-500);
    display: block;
    color: var(--color-ink);
    font: inherit;
  }
  :host([hidden]) { display: none; }
  :host([disabled]) { opacity: 0.6; }

  .label {
    display: block;
    margin-bottom: 0.375rem;
    font-size: 0.875rem;
    font-weight: 500;
  }

  .field {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.375rem;
    min-height: 2.5rem;
    padding: 0.375rem 0.5rem;
    border: 1px solid var(--color-ink-muted); /* 3:1 or more against the page, like other inputs */
    border-radius: 0.375rem;
    background: var(--color-bg);
    cursor: text;
  }
  .field:hover { border-color: var(--tag-focus); }
  .field:focus-within {
    border-color: var(--tag-focus);
    outline: 2px solid var(--tag-focus);
    outline-offset: 2px;
  }
  .field.invalid { border-color: var(--color-red-600); }
  :host([readonly]) .field {
    min-height: 0;
    padding: 0;
    border: 0;
    background: none;
    cursor: default;
    outline: none;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .chips:empty { display: none; }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.125rem;
    padding: 0.125rem 0.25rem 0.125rem 0.5rem;
    border: 0;
    border-radius: 9999px;
    background: var(--tag-bg);
    color: var(--tag-fg);
    font: inherit;
    font-size: 0.75rem;
    font-weight: 500;
    line-height: 1rem;
  }
  button.chip {
    min-height: 1.5rem; /* 24px tap target */
    padding-right: 0.5rem;
    cursor: pointer;
  }
  button.chip:hover { text-decoration: underline; }

  .remove {
    display: inline-grid;
    place-items: center;
    width: 1rem;
    height: 1rem;
    padding: 0;
    border: 0;
    border-radius: 9999px;
    background: none;
    color: inherit;
    cursor: pointer;
  }
  .remove:hover { background: var(--color-purple-50); }
  .remove svg { width: 0.75rem; height: 0.75rem; }

  button:focus-visible {
    outline: 2px solid var(--tag-focus);
    outline-offset: 1px;
  }
  button:disabled { cursor: not-allowed; }

  input {
    flex: 1 1 6rem;
    min-width: 6rem;
    padding: 0.25rem;
    border: 0;
    outline: none;
    background: none;
    color: inherit;
    font: inherit;
    font-size: 0.875rem;
  }
  input::placeholder { color: var(--color-ink-muted); }
  input[hidden] { display: none; }

  .hint, .error, .empty {
    margin: 0.375rem 0 0;
    font-size: 0.75rem;
  }
  .hint, .empty { color: var(--color-ink-muted); }
  .error { color: var(--color-red-600); }
  .error:empty { display: none; }
  .empty { margin: 0; }
  :host([readonly]) .hint, :host([readonly]) .error { display: none; }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
`

// Static markup only. User text is always set with textContent, never innerHTML.
const markup = /* html */ `
  <style>${styles}</style>
  <label class="label" part="label" id="label" for="input"></label>
  <div class="field" part="field">
    <ul class="chips" aria-labelledby="label"></ul>
    <p class="empty" hidden>No tags</p>
    <input id="input" part="input" type="text" autocomplete="off" autocapitalize="none"
      spellcheck="false" enterkeyhint="done" aria-describedby="hint error" />
  </div>
  <p class="hint" id="hint">Press Enter or comma to add a tag. Backspace removes the last one.</p>
  <p class="error" id="error" aria-live="polite"></p>
  <p class="sr-only" id="status" aria-live="polite"></p>
`

const removeIcon =
  '<svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor"><path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L8.94 10l-4.72 4.72a.75.75 0 1 0 1.06 1.06L10 11.06l4.72 4.72a.75.75 0 1 0 1.06-1.06L11.06 10l4.72-4.72a.75.75 0 0 0-1.06-1.06L10 8.94 5.28 4.22Z"/></svg>'

function required<T extends Element>(root: ShadowRoot, selector: string): T {
  const el = root.querySelector<T>(selector)
  if (!el) throw new Error(`tag-input: missing ${selector}`)
  return el
}

export class TagInputElement extends HTMLElement {
  static readonly observedAttributes = ['label', 'value', 'placeholder', 'max-tags', 'readonly', 'disabled', 'error']

  #tags: string[] = []
  /** The element's own message (e.g. an invalid tag). Shown before the error attribute's. */
  #ownError = ''
  readonly #root: ShadowRoot
  readonly #label: HTMLLabelElement
  readonly #field: HTMLDivElement
  readonly #list: HTMLUListElement
  readonly #empty: HTMLParagraphElement
  readonly #input: HTMLInputElement
  readonly #error: HTMLParagraphElement
  readonly #status: HTMLParagraphElement
  /** Which kind of chips are rendered, so a readonly/disabled change rebuilds them. */
  #chipMode = ''

  constructor() {
    super()
    this.#root = this.attachShadow({ mode: 'open', delegatesFocus: true })
    this.#root.innerHTML = markup
    this.#label = required(this.#root, '.label')
    this.#field = required(this.#root, '.field')
    this.#list = required(this.#root, '.chips')
    this.#empty = required(this.#root, '.empty')
    this.#input = required(this.#root, 'input')
    this.#error = required(this.#root, '.error')
    this.#status = required(this.#root, '#status')

    this.#input.addEventListener('keydown', this.#onKeyDown)
    this.#input.addEventListener('input', this.#onInput)
    this.#list.addEventListener('click', this.#onChipClick)
    this.#field.addEventListener('click', (event) => {
      if (event.target === this.#field) this.#input.focus()
    })
  }

  connectedCallback(): void {
    this.#render()
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    if (name === 'value') {
      this.#tags = cleanTags((value ?? '').split(','))
    }
    this.#render()
  }

  /** The current tags. Setting them doesn't fire tags-change. */
  get tags(): string[] {
    return [...this.#tags]
  }

  set tags(tags: readonly string[]) {
    this.#tags = cleanTags(tags)
    this.#render()
  }

  get maxTags(): number {
    const n = Number(this.getAttribute('max-tags'))
    return Number.isInteger(n) && n > 0 ? n : MAX_TAGS
  }

  /**
   * Adds any text still in the input as tags, e.g. when a form is submitted
   * before Enter was pressed. Returns false if some of it was rejected; that
   * text stays in the input with an explanation.
   */
  commitPending(): boolean {
    if (this.#input.value.trim() === '') return true
    this.#commit(this.#input.value)
    return this.#input.value === ''
  }

  get #readOnly(): boolean {
    return this.hasAttribute('readonly')
  }

  get #disabled(): boolean {
    return this.hasAttribute('disabled')
  }

  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (event.isComposing) return
    if (event.key === 'Enter') {
      event.preventDefault()
      this.#commit(this.#input.value)
    } else if (event.key === 'Backspace' && this.#input.value === '' && this.#tags.length > 0) {
      event.preventDefault()
      const last = this.#tags.at(-1)
      if (last) this.#remove(last)
    }
  }

  // Commas are handled here rather than on keydown, so pasting "a, b, c"
  // and mobile keyboards (which often don't report the key) both work.
  readonly #onInput = (): void => {
    this.#setError('')
    if (this.#input.value.includes(',')) {
      this.#commit(this.#input.value)
    }
  }

  readonly #onChipClick = (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) return
    const button = event.target.closest('button')
    const tag = button?.closest('li')?.dataset.tag
    if (!button || !tag) return

    if (button.dataset.action === 'remove') {
      this.#remove(tag)
      this.#input.focus()
    } else if (this.#readOnly) {
      this.dispatchEvent(
        new CustomEvent<TagClickDetail>('tag-click', { detail: { tag }, bubbles: true, composed: true }),
      )
    }
  }

  /** Adds every comma-separated tag in text. Rejected ones stay in the input with an explanation. */
  #commit(text: string): void {
    const added: string[] = []
    const rejected: string[] = []
    let message = ''

    for (const part of text.split(',')) {
      const tag = normalizeTag(part)
      if (!tag) continue
      const problem = this.#problemWith(tag)
      if (problem) {
        rejected.push(part.trim())
        message ||= problem
      } else {
        this.#tags.push(tag)
        added.push(tag)
      }
    }

    this.#input.value = rejected.join(', ')
    this.#setError(message)
    if (added.length > 0) {
      this.#render()
      this.#announce(added.length === 1 ? `Added tag ${added[0]}` : `Added tags ${added.join(', ')}`)
      this.#emitChange()
    }
  }

  #problemWith(tag: string): string | null {
    if (this.#tags.includes(tag)) return `"${tag}" is already added.`
    if (this.#tags.length >= this.maxTags) return `You can add up to ${this.maxTags} tags.`
    return tagError(tag)
  }

  #remove(tag: string): void {
    this.#tags = this.#tags.filter((t) => t !== tag)
    this.#setError('')
    this.#render()
    this.#announce(`Removed tag ${tag}`)
    this.#emitChange()
  }

  #emitChange(): void {
    this.dispatchEvent(
      new CustomEvent<TagsChangeDetail>('tags-change', { detail: { tags: this.tags }, bubbles: true, composed: true }),
    )
  }

  #setError(message: string): void {
    this.#ownError = message
    this.#showError()
  }

  /**
   * Shows the element's own message and the error attribute (both, when they
   * differ). They go in #error, which the input's aria-describedby points to
   * and which is a live region, so screen readers hear them.
   */
  #showError(): void {
    const fromForm = this.getAttribute('error') ?? ''
    const message = [this.#ownError, fromForm === this.#ownError ? '' : fromForm].filter(Boolean).join(' ')
    if (this.#error.textContent !== message) this.#error.textContent = message
    this.#field.classList.toggle('invalid', message !== '')
    if (message) {
      this.#input.setAttribute('aria-invalid', 'true')
    } else {
      this.#input.removeAttribute('aria-invalid')
    }
  }

  #announce(message: string): void {
    this.#status.textContent = message
  }

  #render(): void {
    const readOnly = this.#readOnly
    const disabled = this.#disabled

    this.#label.textContent = this.getAttribute('label') ?? 'Tags'
    this.#input.placeholder = this.getAttribute('placeholder') ?? 'Add a tag'
    this.#input.hidden = readOnly
    this.#input.disabled = disabled
    this.#empty.hidden = !(readOnly && this.#tags.length === 0)
    this.#showError()

    this.#renderChips(`${readOnly}:${disabled}`)
  }

  /**
   * Updates chips in place where possible (append new, remove deleted) so a
   * chip being clicked is never replaced mid-click. Rebuilds otherwise.
   */
  #renderChips(mode: string): void {
    const items = Array.from(this.#list.children).filter((el): el is HTMLLIElement => el instanceof HTMLLIElement)
    const kept = items.filter((li) => this.#tags.includes(li.dataset.tag ?? ''))
    const inOrder = kept.every((li, i) => li.dataset.tag === this.#tags[i])

    if (mode !== this.#chipMode || !inOrder) {
      this.#chipMode = mode
      this.#list.replaceChildren(...this.#tags.map((tag) => this.#createChip(tag)))
      return
    }
    for (const li of items) {
      if (!kept.includes(li)) li.remove()
    }
    for (const tag of this.#tags.slice(kept.length)) {
      this.#list.append(this.#createChip(tag))
    }
  }

  #createChip(tag: string): HTMLLIElement {
    const li = document.createElement('li')
    li.dataset.tag = tag

    if (this.#readOnly) {
      const chip = document.createElement('button')
      chip.type = 'button'
      chip.className = 'chip'
      chip.setAttribute('part', 'chip')
      chip.textContent = tag
      chip.disabled = this.#disabled
      li.append(chip)
      return li
    }

    const chip = document.createElement('span')
    chip.className = 'chip'
    chip.setAttribute('part', 'chip')
    const text = document.createElement('span')
    text.textContent = tag
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'remove'
    remove.dataset.action = 'remove'
    remove.setAttribute('aria-label', `Remove tag ${tag}`)
    remove.disabled = this.#disabled
    remove.innerHTML = removeIcon
    chip.append(text, remove)
    li.append(chip)
    return li
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tag-input': TagInputElement
  }
  interface HTMLElementEventMap {
    'tags-change': CustomEvent<TagsChangeDetail>
    'tag-click': CustomEvent<TagClickDetail>
  }
}

if (!customElements.get('tag-input')) {
  customElements.define('tag-input', TagInputElement)
}

// Dev only: a custom element can't be redefined, so a hot update would leave
// the old class registered (e.g. new methods missing on the page's elements).
// Reload the page instead whenever this module or its imports change.
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload())
}
