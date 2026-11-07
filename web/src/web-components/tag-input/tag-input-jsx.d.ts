// Lets JSX use <tag-input> with its attributes type-checked.
import type { DetailedHTMLProps, HTMLAttributes } from 'react'
import type { TagInputElement } from './tag-input'

type TagInputAttributes = DetailedHTMLProps<HTMLAttributes<TagInputElement>, TagInputElement> & {
  label?: string
  value?: string
  placeholder?: string
  'max-tags'?: number
  /** Boolean attributes: pass '' to set, undefined to remove. */
  readonly?: ''
  disabled?: ''
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'tag-input': TagInputAttributes
    }
  }
}
