import { buttonStyles } from './buttonStyles'

interface ErrorStateProps {
  title: string
  message: string
  onRetry: () => void
  retrying?: boolean
}

export function ErrorState({ title, message, onRetry, retrying = false }: Readonly<ErrorStateProps>) {
  return (
    <div role="alert" className="m-4 flex gap-3 rounded-lg border border-red-600 bg-red-50 p-4">
      <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 size-5 shrink-0 text-red-600" fill="currentColor">
        <path
          fillRule="evenodd"
          d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
          clipRule="evenodd"
        />
      </svg>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-ink">{title}</p>
        <p className="mt-1 text-sm text-ink-muted">{message}</p>
        <button type="button" onClick={onRetry} disabled={retrying} className={`${buttonStyles.danger} mt-3`}>
          {retrying ? 'Retrying…' : 'Retry'}
        </button>
      </div>
    </div>
  )
}
