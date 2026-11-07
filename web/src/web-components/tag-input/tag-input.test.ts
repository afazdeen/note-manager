import { fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import './tag-input'
import type { TagClickDetail, TagsChangeDetail } from './tag-input'

/** Creates a <tag-input> with the given attributes and returns helpers for its shadow DOM. */
function mount(attributes: Record<string, string> = {}) {
  const el = document.createElement('tag-input')
  for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value)
  document.body.append(el)

  const root = el.shadowRoot
  if (!root) throw new Error('tag-input has no shadow root')
  // Testing Library queries work on a ShadowRoot; only the type says HTMLElement.
  const shadow = within(root as unknown as HTMLElement)

  const changes: string[][] = []
  el.addEventListener('tags-change', (e: CustomEvent<TagsChangeDetail>) => changes.push(e.detail.tags))

  return {
    el,
    shadow,
    changes,
    user: userEvent.setup(),
    input: () => shadow.getByRole('textbox'),
    chipTexts: () => Array.from(root.querySelectorAll('li')).map((li) => li.dataset.tag),
    error: () => root.querySelector('.error')?.textContent ?? '',
  }
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('<tag-input>', () => {
  it('has a visible label tied to its input, and a hint', () => {
    const { shadow } = mount({ label: 'Note tags' })

    expect(shadow.getByText('Note tags').tagName).toBe('LABEL')
    expect(shadow.getByRole('textbox')).toHaveAccessibleName('Note tags')
    expect(shadow.getByRole('textbox')).toHaveAccessibleDescription(/press enter or comma to add a tag/i)
  })

  it('adds a normalised tag on Enter and fires tags-change', async () => {
    const { user, input, chipTexts, changes } = mount()

    await user.type(input(), '  Release {Enter}')

    expect(chipTexts()).toEqual(['release'])
    expect(changes).toEqual([['release']])
    expect(input()).toHaveValue('')
  })

  it('adds a tag on comma, and several at once when pasting a list', async () => {
    const { user, input, chipTexts } = mount()

    await user.type(input(), 'go,')
    expect(chipTexts()).toEqual(['go'])

    // A paste ends in an input event with the pasted text. (user-event's paste
    // can't find the focused input inside shadow DOM, so fire it directly.)
    fireEvent.input(input(), { target: { value: 'api, Team-1 ,docs' } })
    expect(chipTexts()).toEqual(['go', 'api', 'team-1', 'docs'])
    expect(input()).toHaveValue('')
  })

  it('removes the last tag on Backspace only when the input is empty', async () => {
    const { el, user, input, chipTexts, changes } = mount()
    el.tags = ['one', 'two']

    await user.type(input(), 'x{Backspace}')
    expect(chipTexts()).toEqual(['one', 'two'])

    await user.keyboard('{Backspace}')
    expect(chipTexts()).toEqual(['one'])
    expect(changes).toEqual([['one']])
  })

  it('gives each chip a labelled remove button that keeps focus in the field', async () => {
    const { el, shadow, user, input, chipTexts, changes } = mount()
    el.tags = ['design', 'ui']

    await user.click(shadow.getByRole('button', { name: 'Remove tag design' }))

    expect(chipTexts()).toEqual(['ui'])
    expect(changes).toEqual([['ui']])
    expect(el.shadowRoot?.activeElement).toBe(input())
  })

  it.each([
    ['invalid characters', 'Bad Tag!', `"bad tag!" isn't a valid tag`],
    ['a leading hyphen', '-draft', `"-draft" isn't a valid tag`],
    ['more than 24 characters', 'a'.repeat(25), 'is too long'],
  ])('rejects a tag with %s and explains why', async (_why, typed, message) => {
    const { user, input, chipTexts, changes, error } = mount()

    await user.type(input(), `${typed}{Enter}`)

    expect(chipTexts()).toEqual([])
    expect(changes).toEqual([])
    expect(error()).toContain(message)
    expect(input()).toHaveValue(typed) // kept so it can be fixed
    expect(input()).toHaveAttribute('aria-invalid', 'true')
    expect(input()).toHaveAccessibleDescription(expect.stringContaining(message))
  })

  it('clears the explanation once you type again', async () => {
    const { user, input, error } = mount()
    await user.type(input(), '-x{Enter}')
    expect(error()).not.toBe('')

    await user.type(input(), 'y')

    expect(error()).toBe('')
    expect(input()).not.toHaveAttribute('aria-invalid')
  })

  it('rejects duplicates and tags over max-tags', async () => {
    const { el, user, input, chipTexts, error } = mount({ 'max-tags': '2' })
    el.tags = ['go']

    await user.type(input(), 'GO{Enter}')
    expect(error()).toBe('"go" is already added.')
    expect(input()).toHaveValue('GO')

    await user.type(input(), '{Backspace}{Backspace}api{Enter}third{Enter}')
    expect(chipTexts()).toEqual(['go', 'api'])
    expect(error()).toBe('You can add up to 2 tags.')
  })

  it('takes initial tags from the value attribute or the tags property, without firing tags-change', () => {
    const { el, chipTexts, changes } = mount({ value: 'b, A,b, not valid!' })
    expect(chipTexts()).toEqual(['b', 'a'])

    el.tags = ['x', 'y']
    expect(chipTexts()).toEqual(['x', 'y'])
    expect(el.tags).toEqual(['x', 'y'])
    expect(changes).toEqual([])
  })

  it('in readonly mode shows chips as buttons that fire tag-click, with no input or remove buttons', async () => {
    const { el, shadow, user } = mount({ readonly: '' })
    el.tags = ['planning', 'team']
    const onClick = vi.fn<(detail: TagClickDetail) => void>()
    el.addEventListener('tag-click', (e) => onClick(e.detail))

    expect(shadow.queryByRole('textbox')).not.toBeInTheDocument()
    expect(shadow.queryByRole('button', { name: /remove tag/i })).not.toBeInTheDocument()

    await user.click(shadow.getByRole('button', { name: 'team' }))
    expect(onClick).toHaveBeenCalledWith({ tag: 'team' })
  })

  it('switches between editable and readonly when the attribute changes', () => {
    const { el, shadow } = mount()
    el.tags = ['go']
    expect(shadow.getByRole('button', { name: 'Remove tag go' })).toBeInTheDocument()

    el.setAttribute('readonly', '')
    expect(shadow.getByRole('button', { name: 'go' })).toBeInTheDocument()
    expect(shadow.queryByRole('textbox')).not.toBeInTheDocument()

    el.removeAttribute('readonly')
    expect(shadow.getByRole('textbox')).toBeInTheDocument()
  })

  it('disables the input and remove buttons when disabled', () => {
    const { el, shadow } = mount({ disabled: '' })
    el.tags = ['go']

    expect(shadow.getByRole('textbox')).toBeDisabled()
    expect(shadow.getByRole('button', { name: 'Remove tag go' })).toBeDisabled()
  })

  it('commitPending() adds typed text, and reports false when it is rejected', async () => {
    const { el, user, input, chipTexts, changes } = mount()

    await user.type(input(), 'docs')
    expect(el.commitPending()).toBe(true)
    expect(chipTexts()).toEqual(['docs'])
    expect(changes).toEqual([['docs']])

    // Set the text directly: after the component clears its input, user-event
    // (which can't see focus inside shadow DOM) would keep typing after "docs".
    fireEvent.input(input(), { target: { value: '-bad' } })
    expect(el.commitPending()).toBe(false)
    expect(input()).toHaveValue('-bad')
    expect(chipTexts()).toEqual(['docs'])
  })

  it('commitPending() is a no-op when nothing is typed', () => {
    const { el, changes } = mount()

    expect(el.commitPending()).toBe(true)
    expect(changes).toEqual([])
  })

  it('renders the label as text, never as HTML', () => {
    const { el, shadow } = mount({ label: '<img src=x onerror=alert(1)>' })

    expect(el.shadowRoot?.querySelector('img')).toBeNull()
    expect(shadow.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
  })
})
