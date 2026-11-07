import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ToastContext, type ToastApi, type ToastKind } from './toast-context'

/** Errors stay longer so there is time to read them. */
const TOAST_DURATION_MS: Record<ToastKind, number> = { success: 4_000, error: 8_000 }
const MAX_TOASTS = 3

interface Toast {
  id: number
  kind: ToastKind
  message: string
}

let nextId = 1

export function ToastProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id))
  }, [])

  const api = useMemo<ToastApi>(() => {
    const show = (kind: ToastKind, message: string) => {
      const id = nextId++
      setToasts((current) => [...current, { id, kind, message }].slice(-MAX_TOASTS))
    }
    return {
      success: (message) => show('success', message),
      error: (message) => show('error', message),
      dismiss,
    }
  }, [dismiss])

  return (
    <ToastContext value={api}>
      {children}
      {/* Always rendered so screen readers are already watching it when a toast appears. */}
      <section
        aria-label="Notifications"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col gap-2 sm:left-auto sm:w-96"
      >
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </section>
    </ToastContext>
  )
}

function ToastItem({ toast, onDismiss }: Readonly<{ toast: Toast; onDismiss: (id: number) => void }>) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), TOAST_DURATION_MS[toast.kind])
    return () => window.clearTimeout(timer)
  }, [toast.id, toast.kind, onDismiss])

  const isError = toast.kind === 'error'

  return (
    <div
      role={isError ? 'alert' : 'status'}
      className={`pointer-events-auto flex items-start gap-3 rounded-lg border p-3 text-sm text-ink ${
        isError ? 'border-red-600 bg-red-50' : 'border-green-700 bg-green-50'
      }`}
    >
      <ToastIcon kind={toast.kind} />
      <p className="flex-1 pt-0.5">{toast.message}</p>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="-m-1 rounded-md p-1 text-ink-muted hover:bg-bg hover:text-ink"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4" fill="currentColor">
          <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L8.94 10l-4.72 4.72a.75.75 0 1 0 1.06 1.06L10 11.06l4.72 4.72a.75.75 0 1 0 1.06-1.06L11.06 10l4.72-4.72a.75.75 0 0 0-1.06-1.06L10 8.94 5.28 4.22Z" />
        </svg>
      </button>
    </div>
  )
}

function ToastIcon({ kind }: Readonly<{ kind: ToastKind }>) {
  if (kind === 'error') {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 size-5 shrink-0 text-red-600" fill="currentColor">
        <path
          fillRule="evenodd"
          d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
          clipRule="evenodd"
        />
      </svg>
    )
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 size-5 shrink-0 text-green-700" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z"
        clipRule="evenodd"
      />
    </svg>
  )
}
