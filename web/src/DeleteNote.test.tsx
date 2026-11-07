import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { App } from './App'
import { apiError, apiUrl, db } from './test/handlers'
import { renderWithClient } from './test/render'
import { server } from './test/server'
import { setViewportWidth } from './test/viewport'

/** Ids of every DELETE request, recorded without changing the response. */
let deleted: string[] = []

beforeEach(() => {
  deleted = []
  server.use(
    http.delete(apiUrl('/notes/:id'), ({ params }) => {
      deleted.push(String(params.id))
      // Returning nothing falls through to the default handler.
    }),
  )
})

async function renderApp(url = '/', firstRow = 'Sprint planning') {
  window.history.replaceState(null, '', url)
  const user = userEvent.setup()
  renderWithClient(<App />)
  await screen.findByRole('button', { name: firstRow })
  return { user }
}

/** Holds the next DELETE response until release() is called; then answers with `respond`. */
function holdDelete(respond: () => Response | undefined = () => undefined) {
  let release: () => void = () => undefined
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  server.use(
    http.delete(apiUrl('/notes/:id'), async () => {
      await released
      return respond()
    }),
  )
  return { release }
}

const noteParam = () => new URLSearchParams(window.location.search).get('note')
const list = () => screen.getByRole('list', { name: 'Notes' })
const detail = () => screen.getByRole('region', { name: 'Note details' })
const confirmDialog = () => screen.getByRole('alertdialog', { name: 'Delete this note?' })
const rowTitles = () =>
  within(list())
    .getAllByRole('listitem')
    .map((item) => item.querySelector('[data-note-id] [id$="-title"]')?.textContent)

describe('asking first', () => {
  it('opens a confirmation with focus on Cancel; Cancel keeps the note and returns focus', async () => {
    const { user } = await renderApp('/?note=n2')
    const deleteButton = await within(detail()).findByRole('button', { name: 'Delete' })

    await user.click(deleteButton)

    expect(confirmDialog()).toHaveAccessibleDescription(expect.stringContaining('"API conventions" will be deleted'))
    expect(within(confirmDialog()).getByRole('button', { name: 'Cancel' })).toHaveFocus()

    await user.click(within(confirmDialog()).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(deleteButton).toHaveFocus()
    expect(rowTitles()).toEqual(['Sprint planning', 'API conventions', 'Retro notes'])
    expect(deleted).toEqual([])
  })

  it('Delete on a focused row asks about that note, and Esc cancels back to the row', async () => {
    const { user } = await renderApp('/?note=n1')
    const row = screen.getByRole('button', { name: 'Retro notes' })
    row.focus()

    await user.keyboard('{Delete}')

    expect(confirmDialog()).toHaveAccessibleDescription(expect.stringContaining('"Retro notes"'))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(row).toHaveFocus()
    expect(deleted).toEqual([])
  })

  it("Delete on a row's delete button asks about that row's note, not the open one", async () => {
    const { user } = await renderApp('/?note=n1')
    screen.getByRole('button', { name: 'Delete note Retro notes' }).focus()

    await user.keyboard('{Delete}')

    expect(confirmDialog()).toHaveAccessibleDescription(expect.stringContaining('"Retro notes"'))
  })

  it('Backspace on a focused row also asks (Mac keyboards label it "delete")', async () => {
    const { user } = await renderApp('/?note=n1')
    screen.getByRole('button', { name: 'API conventions' }).focus()

    await user.keyboard('{Backspace}')

    expect(confirmDialog()).toHaveAccessibleDescription(expect.stringContaining('"API conventions"'))
  })

  it('Delete with no row focused asks about the open note', async () => {
    const { user } = await renderApp('/?note=n2')
    await within(detail()).findByRole('heading', { level: 2, name: 'API conventions' })
    document.body.focus()

    await user.keyboard('{Delete}')

    expect(confirmDialog()).toHaveAccessibleDescription(expect.stringContaining('"API conventions"'))
  })
})

describe('deleting', () => {
  it('removes the note straight away, selects the next one, and confirms with a toast', async () => {
    const { release } = holdDelete()
    const { user } = await renderApp('/?note=n2')

    await user.click(await within(detail()).findByRole('button', { name: 'Delete' }))
    await user.click(within(confirmDialog()).getByRole('button', { name: 'Delete note' }))

    // Before the server has answered:
    await waitFor(() => expect(rowTitles()).toEqual(['Sprint planning', 'Retro notes']))
    expect(noteParam()).toBe('n3')
    expect(within(detail()).getByRole('heading', { level: 2, name: 'Retro notes' })).toBeInTheDocument()

    release()

    expect(await screen.findByRole('status')).toHaveTextContent('Note deleted')
    expect(db.ids()).toEqual(['n1', 'n3'])
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retro notes' })).toHaveFocus())
  })

  it('deletes from a list row without changing the open note', async () => {
    const { user } = await renderApp('/?note=n1')

    await user.click(screen.getByRole('button', { name: 'Delete note API conventions' }))
    await user.click(within(confirmDialog()).getByRole('button', { name: 'Delete note' }))

    await waitFor(() => expect(rowTitles()).toEqual(['Sprint planning', 'Retro notes']))
    expect(noteParam()).toBe('n1')
    expect(deleted).toEqual(['n2'])
  })

  it('selects nothing when the only note is deleted', async () => {
    // The list only ever shows n3 (while it exists).
    server.use(http.get(apiUrl('/notes'), () => Response.json({ notes: db.search('').filter((n) => n.id === 'n3') })))
    const { user } = await renderApp('/?note=n3', 'Retro notes')

    await user.click(await within(detail()).findByRole('button', { name: 'Delete' }))
    await user.click(within(confirmDialog()).getByRole('button', { name: 'Delete note' }))

    await waitFor(() => expect(noteParam()).toBeNull())
    expect(within(detail()).getByRole('heading', { name: 'Select a note' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'No notes yet' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'New note' })).toHaveFocus())
  })

  it('selects the previous note when deleting the last note in the list', async () => {
    const { user } = await renderApp('/?note=n3')

    await user.click(await within(detail()).findByRole('button', { name: 'Delete' }))
    await user.click(within(confirmDialog()).getByRole('button', { name: 'Delete note' }))

    await waitFor(() => expect(noteParam()).toBe('n2'))
  })

  it('treats a note that is already gone (deleted by an agent) as deleted', async () => {
    server.use(http.delete(apiUrl('/notes/:id'), () => apiError(404, 'not_found', 'Note not found.')))
    const { user } = await renderApp('/?note=n2')

    await user.click(await within(detail()).findByRole('button', { name: 'Delete' }))
    await user.click(within(confirmDialog()).getByRole('button', { name: 'Delete note' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Note deleted')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(noteParam()).toBe('n3')
  })

  it("doesn't leave the deleted note in the browser history", async () => {
    const { user } = await renderApp('/')
    await user.click(screen.getByRole('button', { name: 'Sprint planning' }))
    await user.click(screen.getByRole('button', { name: 'API conventions' }))

    await user.click(within(detail()).getByRole('button', { name: 'Delete' }))
    await user.click(within(confirmDialog()).getByRole('button', { name: 'Delete note' }))
    await waitFor(() => expect(noteParam()).toBe('n3'))

    window.history.back()

    await waitFor(() => expect(noteParam()).toBe('n1'))
  })

  it('on a phone, moves focus to the next note after deleting the open one', async () => {
    setViewportWidth(375)
    const { user } = await renderApp('/?note=n2')

    await user.click(await within(detail()).findByRole('button', { name: 'Delete' }))
    await user.click(within(confirmDialog()).getByRole('button', { name: 'Delete note' }))

    await waitFor(() => expect(detail()).toHaveFocus())
    expect(within(detail()).getByRole('heading', { level: 2, name: 'Retro notes' })).toBeInTheDocument()
  })
})

describe('when the server fails', () => {
  it('puts the note back, re-selects it, and shows an error toast', async () => {
    const { release } = holdDelete(() => apiError(500, 'internal', 'Something went wrong. Please try again.'))
    const { user } = await renderApp('/?note=n2')

    await user.click(await within(detail()).findByRole('button', { name: 'Delete' }))
    await user.click(within(confirmDialog()).getByRole('button', { name: 'Delete note' }))

    await waitFor(() => expect(rowTitles()).toEqual(['Sprint planning', 'Retro notes']))
    expect(noteParam()).toBe('n3')

    release()

    await waitFor(() => expect(rowTitles()).toEqual(['Sprint planning', 'API conventions', 'Retro notes']))
    expect(noteParam()).toBe('n2')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't delete the note. Something went wrong. Please try again.",
    )
    expect(db.ids()).toEqual(['n1', 'n2', 'n3'])
  })
})
