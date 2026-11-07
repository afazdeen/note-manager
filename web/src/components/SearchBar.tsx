import { useId, type RefObject } from 'react'

interface SearchBarProps {
  value: string
  onChange: (value: string) => void
  /** The parent owns the ref so the "/" shortcut can focus the input. */
  inputRef: RefObject<HTMLInputElement | null>
  /** True while a new search is loading. */
  busy?: boolean
  className?: string
}

export function SearchBar({ value, onChange, inputRef, busy = false, className = '' }: Readonly<SearchBarProps>) {
  const id = useId()

  const clear = () => {
    onChange('')
    inputRef.current?.focus()
  }

  return (
    <search className={className}>
      <label htmlFor={id} className="sr-only">
        Search notes
      </label>
      <div className="relative">
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted"
        >
          <path
            fillRule="evenodd"
            d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.45 4.39l3.08 3.08a.75.75 0 1 1-1.06 1.06l-3.08-3.08A7 7 0 0 1 2 9Z"
            clipRule="evenodd"
          />
        </svg>
        <input
          ref={inputRef}
          id={id}
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && value) {
              e.preventDefault()
              onChange('')
            }
          }}
          placeholder="Search notes"
          autoComplete="off"
          spellCheck={false}
          aria-keyshortcuts="/"
          className="w-full rounded-md border border-ink-muted bg-bg py-2 pr-16 pl-9 text-sm text-ink placeholder:text-ink-muted hover:border-purple-500 focus:border-purple-500 [&::-webkit-search-cancel-button]:appearance-none"
        />
        <div className="absolute inset-y-0 right-2 flex items-center gap-1">
          {busy && (
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 animate-spin text-purple-500" fill="none">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
              <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          )}
          {value ? (
            <button
              type="button"
              onClick={clear}
              aria-label="Clear search"
              className="rounded p-1 text-ink-muted hover:bg-purple-50 hover:text-ink"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4" fill="currentColor">
                <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L8.94 10l-4.72 4.72a.75.75 0 1 0 1.06 1.06L10 11.06l4.72 4.72a.75.75 0 1 0 1.06-1.06L11.06 10l4.72-4.72a.75.75 0 0 0-1.06-1.06L10 8.94 5.28 4.22Z" />
              </svg>
            </button>
          ) : (
            <kbd
              aria-hidden="true"
              className="hidden rounded border border-border px-1.5 font-sans text-xs text-ink-muted md:inline"
            >
              /
            </kbd>
          )}
        </div>
      </div>
    </search>
  )
}
