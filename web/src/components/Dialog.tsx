import { useEffect, useRef, type ReactNode, type RefObject } from 'react'

interface DialogProps {
  /** id of the element that names the dialog (its heading). */
  labelledBy: string
  /** id of the element that describes it, if any. */
  describedBy?: string
  /** Use "alertdialog" for confirmations that interrupt the user. */
  role?: 'dialog' | 'alertdialog'
  size?: 'sm' | 'md'
  onClose: () => void
  /** When false, Esc does nothing (e.g. while saving). */
  canClose?: boolean
  /** Focused when the dialog opens. */
  initialFocusRef: RefObject<HTMLElement | null>
  /** Focused when the dialog closes. Defaults to whatever had focus when it opened. */
  returnFocusRef?: RefObject<HTMLElement | null>
  children: ReactNode
}

const widths = { sm: 'max-w-sm', md: 'max-w-lg' } as const

/**
 * A modal built on the native <dialog>. showModal() makes the rest of the page
 * inert and keeps focus inside. Render it to open it; unmount it to close it.
 */
export function Dialog({
  labelledBy,
  describedBy,
  role = 'dialog',
  size = 'md',
  onClose,
  canClose = true,
  initialFocusRef,
  returnFocusRef,
  children,
}: Readonly<DialogProps>) {
  const ref = useRef<HTMLDialogElement>(null)
  const latest = useRef({ onClose, canClose })
  useEffect(() => {
    latest.current = { onClose, canClose }
  })

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const returnTo = returnFocusRef?.current ?? previous
    dialog.showModal()
    initialFocusRef.current?.focus()
    return () => {
      if (dialog.open) dialog.close()
      // The element may be gone (e.g. the row of a deleted note); callers then move focus themselves.
      if (returnTo?.isConnected) returnTo.focus()
    }
  }, [initialFocusRef, returnFocusRef])

  const requestClose = () => {
    if (latest.current.canClose) latest.current.onClose()
  }

  return (
    <dialog
      ref={ref}
      role={role === 'alertdialog' ? 'alertdialog' : undefined}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          requestClose()
        }
      }}
      onCancel={(e) => {
        // Other close requests (e.g. Android back). React state decides, not the browser.
        e.preventDefault()
        requestClose()
      }}
      className={`m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] ${widths[size]} overflow-y-auto rounded-xl border border-border bg-bg p-0 text-ink backdrop:bg-ink/40`}
    >
      {children}
    </dialog>
  )
}
