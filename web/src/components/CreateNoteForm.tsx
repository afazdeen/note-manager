import { useId, useRef, useState, type FormEvent, type KeyboardEvent, type RefObject } from 'react'
import { useCreateNote } from '../api/notes'
import type { CreateNoteInput, Note } from '../api/types'
import { fromServerFields, hasErrors, validateNote, type NoteFieldErrors } from '../lib/validateNote'
import { TagInput } from '../web-components/tag-input/TagInput'
import { buttonStyles } from './buttonStyles'
import { Dialog } from './Dialog'

interface CreateNoteDialogProps {
  onCancel: () => void
  onCreated: (note: Note) => void
  /** The button that opened the dialog; focus returns to it on close. */
  returnFocusRef: RefObject<HTMLElement | null>
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)
// Inputs use ink-muted borders: the lighter border token is under the 3:1 a control's edge needs.
const fieldClass =
  'mt-1.5 block w-full rounded-md border bg-bg px-3 py-2 text-sm text-ink placeholder:text-ink-muted hover:border-purple-500 focus:border-purple-500'

export function CreateNoteDialog({ onCancel, onCreated, returnFocusRef }: Readonly<CreateNoteDialogProps>) {
  const create = useCreateNote()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [errors, setErrors] = useState<NoteFieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)

  const formRef = useRef<HTMLFormElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const id = useId()
  const ids = {
    heading: `${id}-heading`,
    title: `${id}-title`,
    titleError: `${id}-title-error`,
    body: `${id}-body`,
    bodyError: `${id}-body-error`,
  }

  const tagInput = () => formRef.current?.querySelector('tag-input') ?? null

  const focusFirstInvalid = (found: NoteFieldErrors) => {
    if (found.title) titleRef.current?.focus()
    else if (found.body) bodyRef.current?.focus()
    else if (found.tags) tagInput()?.focus()
  }

  /** Once a field has an error, re-check it as the user edits so the error clears when fixed. */
  const recheck = (next: CreateNoteInput) => {
    setErrors((current) => {
      if (!hasErrors(current)) return current
      const found = validateNote(next)
      return {
        title: current.title && found.title,
        body: current.body && found.body,
        tags: current.tags && found.tags,
      }
    })
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (create.isPending) return

    // Commit a tag that was typed but not yet added with Enter.
    const el = tagInput()
    const pendingTagOk = el ? el.commitPending() : true
    const input: CreateNoteInput = { title, body, tags: el?.tags ?? tags }

    const found = validateNote(input)
    if (!pendingTagOk) found.tags = "Fix or clear the tag you're typing, or press Backspace to remove it."
    setErrors(found)
    setFormError(null)
    if (hasErrors(found)) {
      focusFirstInvalid(found)
      return
    }

    create.mutate(input, {
      onSuccess: onCreated,
      onError: (error) => {
        if (error.code === 'validation_failed') {
          const fromServer = fromServerFields(error.fields)
          if (hasErrors(fromServer)) {
            setErrors(fromServer)
            focusFirstInvalid(fromServer)
            return
          }
        }
        setFormError(error.message)
      },
    })
  }

  const onFormKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      formRef.current?.requestSubmit()
    }
  }

  const saving = create.isPending

  return (
    <Dialog
      labelledBy={ids.heading}
      onClose={onCancel}
      canClose={!saving}
      initialFocusRef={titleRef}
      returnFocusRef={returnFocusRef}
    >
      <form ref={formRef} noValidate onSubmit={submit} onKeyDown={onFormKeyDown} className="flex flex-col gap-5 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-4">
          <h2 id={ids.heading} className="text-lg font-semibold">
            New note
          </h2>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            aria-label="Close"
            className="-m-1 rounded-md p-1 text-ink-muted hover:bg-purple-50 hover:text-ink"
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5" fill="currentColor">
              <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L8.94 10l-4.72 4.72a.75.75 0 1 0 1.06 1.06L10 11.06l4.72 4.72a.75.75 0 1 0 1.06-1.06L11.06 10l4.72-4.72a.75.75 0 0 0-1.06-1.06L10 8.94 5.28 4.22Z" />
            </svg>
          </button>
        </div>

        {formError && (
          <div role="alert" className="rounded-md border border-red-600 bg-red-50 p-3 text-sm text-ink">
            <p className="font-medium">Couldn't save the note.</p>
            <p className="mt-0.5 text-ink-muted">{formError} Your text is still here, so you can try again.</p>
          </div>
        )}

        <div>
          <label htmlFor={ids.title} className="text-sm font-medium">
            Title
          </label>
          <input
            ref={titleRef}
            id={ids.title}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              recheck({ title: e.target.value, body, tags })
            }}
            onKeyDown={(e) => {
              // Plain Enter moves on to the body instead of saving a half-written note.
              if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
                e.preventDefault()
                bodyRef.current?.focus()
              }
            }}
            autoComplete="off"
            aria-invalid={errors.title ? true : undefined}
            aria-describedby={errors.title ? ids.titleError : undefined}
            className={`${fieldClass} ${errors.title ? 'border-red-600' : 'border-ink-muted'}`}
          />
          <FieldError id={ids.titleError} message={errors.title} />
        </div>

        <div>
          <label htmlFor={ids.body} className="text-sm font-medium">
            Body <span className="font-normal text-ink-muted">(optional)</span>
          </label>
          <textarea
            ref={bodyRef}
            id={ids.body}
            value={body}
            rows={6}
            onChange={(e) => {
              setBody(e.target.value)
              recheck({ title, body: e.target.value, tags })
            }}
            aria-invalid={errors.body ? true : undefined}
            aria-describedby={errors.body ? ids.bodyError : undefined}
            className={`${fieldClass} resize-y ${errors.body ? 'border-red-600' : 'border-ink-muted'}`}
          />
          <FieldError id={ids.bodyError} message={errors.body} />
        </div>

        <div>
          <TagInput
            label="Tags (optional)"
            tags={tags}
            onChange={(next) => {
              setTags(next)
              setErrors((current) => (current.tags ? { ...current, tags: undefined } : current))
            }}
            disabled={saving}
            error={errors.tags}
          />
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border pt-4">
          <p className="mr-auto hidden text-xs text-ink-muted sm:block">
            <kbd className="rounded border border-border px-1 font-sans">{isMac ? '⌘' : 'Ctrl'}</kbd> +{' '}
            <kbd className="rounded border border-border px-1 font-sans">Enter</kbd> to save
          </p>
          <button type="button" onClick={onCancel} disabled={saving} className={buttonStyles.secondary}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={buttonStyles.primary}>
            {saving ? 'Saving…' : 'Save note'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

function FieldError({ id, message }: Readonly<{ id: string; message: string | undefined }>) {
  if (!message) return null
  return (
    <p id={id} className="mt-1.5 text-sm text-red-600">
      {message}
    </p>
  )
}
