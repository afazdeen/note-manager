/** A grey placeholder block. Hidden from screen readers; wrap it with a label. */
export function Skeleton({ className = '' }: Readonly<{ className?: string }>) {
  return <div aria-hidden="true" className={`animate-pulse rounded-md bg-border ${className}`} />
}
