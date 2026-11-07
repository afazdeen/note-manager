const chip = 'rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700'

/**
 * Read-only tag chips. Uses spans so it can sit inside a button (list rows).
 * The detail view will use the <tag-input> web component instead.
 */
export function TagChips({ tags, className = '' }: Readonly<{ tags: readonly string[]; className?: string }>) {
  if (tags.length === 0) return null
  return (
    <span className={`flex flex-wrap gap-1 ${className}`}>
      <span className="sr-only">Tags: </span>
      {tags.map((tag) => (
        <span key={tag} className={chip}>
          {tag}
        </span>
      ))}
    </span>
  )
}
