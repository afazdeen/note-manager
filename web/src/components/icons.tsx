export function TrashIcon({ className = 'size-4' }: Readonly<{ className?: string }>) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className={className} fill="currentColor">
      <path
        fillRule="evenodd"
        d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.44c-.8.08-1.58.17-2.37.29a.75.75 0 1 0 .23 1.48l.15-.02.84 10.52A2.75 2.75 0 0 0 7.59 19h4.82a2.75 2.75 0 0 0 2.74-2.54l.84-10.52.15.02a.75.75 0 0 0 .23-1.48c-.79-.12-1.58-.21-2.37-.29v-.44A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.67.03 2.5.08v-.33c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.33C8.33 4.03 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z"
        clipRule="evenodd"
      />
    </svg>
  )
}
