import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { App } from './App'
import { apiError, apiUrl } from './test/handlers'
import { renderWithClient } from './test/render'
import { server } from './test/server'

/** Bodies of every POST /notes, recorded without changing the response. */
let posted: unknown[] = []

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  posted = []
  server.use(
    http.post(apiUrl('/notes'), async ({ request }) => {
      posted.push(await request.clone().json())
      // Returning nothing falls through to the default handler.
    }),
  )
})

async function renderApp() {
  const user = userEvent.setup()
  renderWithClient(<App />)
  await screen.findByRole('button', { name: 'Sprint planning' })
  return { user }
}

const newNoteButton = () => screen.getByRole('button', { name: 'New note' })
const dialog = () => screen.getByRole('dialog', { name: 'New note' })
const titleField = () => within(dialog()).getByLabelText('Title')
const bodyField = () => within(dialog()).getByLabelText(/^Body/)
const saveButton = () => within(dialog()).getByRole('button', { name: /save note|saving/i })

function tagField() {
  const el = dialog().querySelector('tag-input')
  if (!el?.shadowRoot) throw new Error('no <tag-input> in the dialog')
  return within(el.shadowRoot as unknown as HTMLElement).getByRole('textbox')
}

/**
 * Puts text in the tag input. user-event can't see focus inside shadow DOM,
 * so after the component clears its input it would keep typing after the old
 * text. Setting the value and firing the events directly avoids that.
 */
function typeTag(text: string, { enter = false } = {}) {
  fireEvent.input(tagField(), { target: { value: text } })
  if (enter) fireEvent.keyDown(tagField(), { key: 'Enter' })
}

describe('opening and closing', () => {
  it('opens from the button, focuses the title, and Esc returns focus to the button', async () => {
    const { user } = await renderApp()

    await user.click(newNoteButton())
    expect(dialog()).toBeInTheDocument()
    expect(titleField()).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(newNoteButton()).toHaveFocus()
  })

  it('opens with the "n" key and closes with Cancel', async () => {
    const { user } = await renderApp()

    await user.keyboard('n')
    expect(titleField()).toHaveFocus()
    expect(titleField()).toHaveValue('') // the "n" isn't typed into the title

    await user.click(within(dialog()).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(newNoteButton()).toHaveFocus()
  })
})

describe('validation', () => {
  it('shows errors under each field, focuses the first one, and sends nothing', async () => {
    const { user } = await renderApp()
    await user.click(newNoteButton())

    await user.click(saveButton())

    expect(titleField()).toHaveAccessibleDescription('Title is required.')
    expect(titleField()).toHaveAttribute('aria-invalid', 'true')
    expect(titleField()).toHaveFocus()

    await user.type(titleField(), 'Fine title')
    expect(titleField()).not.toHaveAttribute('aria-invalid') // clears once fixed

    await user.click(bodyField())
    await user.paste('b'.repeat(10_001))
    await user.click(saveButton())

    expect(bodyField()).toHaveAccessibleDescription('Body must be at most 10,000 characters (it has 10,001).')
    expect(bodyField()).toHaveFocus()
    expect(posted).toEqual([])
  })

  it('rejects a title over 120 characters', async () => {
    const { user } = await renderApp()
    await user.click(newNoteButton())

    await user.paste('t'.repeat(121))
    await user.click(saveButton())

    expect(titleField()).toHaveAccessibleDescription('Title must be at most 120 characters (it has 121).')
    expect(posted).toEqual([])
  })

  it('stops on a half-typed invalid tag and explains it', async () => {
    const { user } = await renderApp()
    await user.click(newNoteButton())
    await user.type(titleField(), 'Tagged')

    typeTag('Bad Tag!')
    await user.click(saveButton())

    expect(within(dialog()).getByText(/fix or clear the tag you're typing/i)).toBeInTheDocument()
    expect(tagField()).toHaveAccessibleDescription(expect.stringContaining(`"bad tag!" isn't a valid tag`))
    expect(posted).toEqual([])
  })
})

describe('server errors', () => {
  it('shows field errors from the server under the right field', async () => {
    server.use(
      http.post(apiUrl('/notes'), () =>
        apiError(422, 'validation_failed', 'Some fields are invalid.', { title: 'is already used by another note' }),
      ),
    )
    const { user } = await renderApp()
    await user.click(newNoteButton())
    await user.type(titleField(), 'Duplicate')

    await user.click(saveButton())

    await waitFor(() => expect(titleField()).toHaveAccessibleDescription('Title is already used by another note.'))
    expect(titleField()).toHaveFocus()
    expect(dialog()).toBeInTheDocument()
  })

  it('shows other errors at the top, keeps the text, and lets you retry', async () => {
    server.use(
      http.post(apiUrl('/notes'), () => apiError(500, 'internal', 'Something went wrong. Please try again.'), {
        once: true,
      }),
    )
    const { user } = await renderApp()
    await user.click(newNoteButton())
    await user.type(titleField(), 'Keep me')
    await user.type(bodyField(), 'And me')

    await user.click(saveButton())

    const alert = await within(dialog()).findByRole('alert')
    expect(alert).toHaveTextContent("Couldn't save the note.")
    expect(alert).toHaveTextContent('Something went wrong. Please try again.')
    expect(titleField()).toHaveValue('Keep me')
    expect(bodyField()).toHaveValue('And me')
    expect(saveButton()).toBeEnabled()

    await user.click(saveButton())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

describe('saving', () => {
  it('disables Save and ignores Esc while saving', async () => {
    let respond: () => void = () => undefined
    const responded = new Promise<void>((resolve) => {
      respond = resolve
    })
    server.use(
      http.post(apiUrl('/notes'), async () => {
        await responded
      }),
    )
    const { user } = await renderApp()
    await user.click(newNoteButton())
    await user.type(titleField(), 'Slow save')

    await user.click(saveButton())

    expect(saveButton()).toBeDisabled()
    expect(saveButton()).toHaveTextContent('Saving…')
    await user.keyboard('{Escape}')
    expect(dialog()).toBeInTheDocument()

    respond()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('saves with Ctrl+Enter, selects the new note, shows a toast and returns focus', async () => {
    const { user } = await renderApp()
    await user.keyboard('n')
    await user.type(titleField(), '  Release plan ')
    typeTag('Release', { enter: true })
    typeTag('q4') // not added with Enter; saving adds it
    await user.type(bodyField(), 'Ship on Friday')

    await user.keyboard('{Control>}{Enter}{/Control}')

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(posted).toEqual([{ title: '  Release plan ', body: 'Ship on Friday', tags: ['release', 'q4'] }])
    expect(new URLSearchParams(window.location.search).get('note')).toBe('new-1')

    const detail = screen.getByRole('region', { name: 'Note details' })
    expect(within(detail).getByRole('heading', { level: 2, name: 'Release plan' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Note created')
    expect(newNoteButton()).toHaveFocus()
    expect(within(screen.getByRole('list', { name: 'Notes' })).getByRole('button', { name: 'Release plan' })).toHaveAttribute(
      'aria-current',
      'true',
    )
  })

  it('opens from the "Create your first note" button when there are no notes', async () => {
    server.use(http.get(apiUrl('/notes'), () => Response.json({ notes: [] })))
    const user = userEvent.setup()
    renderWithClient(<App />)

    await user.click(await screen.findByRole('button', { name: 'Create your first note' }))

    expect(titleField()).toHaveFocus()
  })
})
