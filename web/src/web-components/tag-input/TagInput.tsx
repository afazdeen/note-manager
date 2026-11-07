import { useEffect, useLayoutEffect, useRef } from 'react'
import './tag-input' // registers <tag-input>
import type { TagInputElement } from './tag-input'

export interface TagInputProps {
  /** Visible label. */
  label: string
  tags: readonly string[]
  /** Called with the new tags after the user adds or removes one. */
  onChange?: (tags: string[]) => void
  /** Called when a chip is clicked in read-only mode. */
  onTagClick?: (tag: string) => void
  placeholder?: string
  maxTags?: number
  readOnly?: boolean
  disabled?: boolean
  /** A validation message from the form. It is shown under the field and linked to its input. */
  error?: string
  className?: string
}

const sameTags = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((tag, i) => tag === b[i])

/** Typed React wrapper for the <tag-input> web component. */
export function TagInput({
  label,
  tags,
  onChange,
  onTagClick,
  placeholder,
  maxTags,
  readOnly = false,
  disabled = false,
  error,
  className,
}: Readonly<TagInputProps>) {
  const ref = useRef<TagInputElement>(null)
  const callbacks = useRef({ onChange, onTagClick })
  useEffect(() => {
    callbacks.current = { onChange, onTagClick }
  })

  // `tags` is a property, not an attribute, so set it on the element directly.
  useLayoutEffect(() => {
    const el = ref.current
    if (el && !sameTags(el.tags, tags)) el.tags = tags
  }, [tags])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const handleChange = (event: CustomEvent<{ tags: string[] }>) => callbacks.current.onChange?.(event.detail.tags)
    const handleClick = (event: CustomEvent<{ tag: string }>) => callbacks.current.onTagClick?.(event.detail.tag)
    el.addEventListener('tags-change', handleChange)
    el.addEventListener('tag-click', handleClick)
    return () => {
      el.removeEventListener('tags-change', handleChange)
      el.removeEventListener('tag-click', handleClick)
    }
  }, [])

  return (
    <tag-input
      ref={ref}
      label={label}
      placeholder={placeholder}
      max-tags={maxTags}
      readonly={readOnly ? '' : undefined}
      disabled={disabled ? '' : undefined}
      error={error || undefined}
      className={className}
    />
  )
}
