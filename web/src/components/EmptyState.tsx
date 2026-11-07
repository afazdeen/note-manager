import type { ReactNode } from 'react'

interface EmptyStateProps {
  title: string
  description?: string
  action?: ReactNode
}

export function EmptyState({ title, description, action }: Readonly<EmptyStateProps>) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div aria-hidden="true" className="mb-4 grid size-12 place-items-center rounded-full bg-gradient-brand">
        <svg viewBox="0 0 24 24" className="size-6 text-white" fill="none" stroke="currentColor" strokeWidth="1.75">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8 4h6l4 4v11a1 1 0 0 1-1 1H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm6 0v4h4M9.5 12h5m-5 3.5h5"
          />
        </svg>
      </div>
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {description && <p className="mt-1 max-w-xs text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
