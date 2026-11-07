import { render, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TagInput } from './TagInput'

function shadowOf(container: HTMLElement) {
  const el = container.querySelector('tag-input')
  if (!el?.shadowRoot) throw new Error('no <tag-input> rendered')
  return { el, shadow: within(el.shadowRoot as unknown as HTMLElement) }
}

describe('TagInput (React wrapper)', () => {
  it('passes tags, label and placeholder to the element', () => {
    const { container } = render(<TagInput label="Tags" tags={['go', 'api']} placeholder="Add one" />)
    const { el, shadow } = shadowOf(container)

    expect(el.tags).toEqual(['go', 'api'])
    expect(shadow.getByRole('textbox')).toHaveAccessibleName('Tags')
    expect(shadow.getByRole('textbox')).toHaveAttribute('placeholder', 'Add one')
  })

  it('calls onChange with the new tags', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    const { container } = render(<TagInput label="Tags" tags={['go']} onChange={onChange} />)
    const { shadow } = shadowOf(container)

    await user.type(shadow.getByRole('textbox'), 'api{Enter}')

    expect(onChange).toHaveBeenCalledWith(['go', 'api'])
  })

  it('updates the element when the tags prop changes', () => {
    const { container, rerender } = render(<TagInput label="Tags" tags={['one']} />)

    rerender(<TagInput label="Tags" tags={['two', 'three']} />)

    expect(shadowOf(container).el.tags).toEqual(['two', 'three'])
  })

  it('is read-only and reports tag clicks when readOnly is set', async () => {
    const onTagClick = vi.fn()
    const user = userEvent.setup()
    const { container } = render(<TagInput label="Tags" tags={['team']} readOnly onTagClick={onTagClick} />)
    const { el, shadow } = shadowOf(container)

    expect(el).toHaveAttribute('readonly')
    expect(shadow.queryByRole('textbox')).not.toBeInTheDocument()

    await user.click(shadow.getByRole('button', { name: 'team' }))
    expect(onTagClick).toHaveBeenCalledWith('team')
  })

  it('passes disabled and max-tags through as attributes', () => {
    const { container } = render(<TagInput label="Tags" tags={[]} disabled maxTags={3} />)
    const { el, shadow } = shadowOf(container)

    expect(el).toHaveAttribute('disabled')
    expect(el).toHaveAttribute('max-tags', '3')
    expect(shadow.getByRole('textbox')).toBeDisabled()
  })
})
