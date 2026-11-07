import { useId, useRef } from 'react'
import { buttonStyles } from './buttonStyles'
import { Dialog } from './Dialog'
import { TrashIcon } from './icons'

interface ConfirmDialogProps {
  title: string
  description: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}

/** Asks before a destructive action. Focus starts on Cancel so Enter can't delete by accident. */
export function ConfirmDialog({ title, description, confirmLabel, onConfirm, onCancel }: Readonly<ConfirmDialogProps>) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const id = useId()

  return (
    <Dialog
      role="alertdialog"
      size="sm"
      labelledBy={`${id}-title`}
      describedBy={`${id}-description`}
      onClose={onCancel}
      initialFocusRef={cancelRef}
    >
      <div className="p-5 sm:p-6">
        <div className="flex gap-3">
          <div aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-red-50">
            <TrashIcon className="size-5 text-red-600" />
          </div>
          <div className="min-w-0">
            <h2 id={`${id}-title`} className="text-lg font-semibold">
              {title}
            </h2>
            <p id={`${id}-description`} className="mt-1 text-sm break-words text-ink-muted">
              {description}
            </p>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button ref={cancelRef} type="button" onClick={onCancel} className={buttonStyles.secondary}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} className={buttonStyles.dangerSolid}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </Dialog>
  )
}
