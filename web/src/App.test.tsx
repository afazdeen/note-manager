import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { App } from './App'
import { apiError, apiUrl } from './test/handlers'
import { renderWithClient } from './test/render'
import { server } from './test/server'

function renderApp(url = '/') {
  window.history.replaceState(null, '', url)
  const user = userEvent.setup()
  renderWithClient(<App />)
  return { user }
}

const noteParam = () => new URLSearchParams(window.location.search).get('note')
const list = () => screen.getByRole('list', { name: 'Notes' })
const detail = () => screen.getByRole('region', { name: 'Note details' })

beforeEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('App shell', () => {
  it('shows the app name, a skip link and a disabled New note button', () => {
    renderApp()

    expect(screen.getByRole('heading', { level: 1, name: 'Team Notes' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main')
    expect(screen.getByRole('button', { name: 'New note' })).toBeDisabled()
  })
})

describe('note list', () => {
  it('shows a skeleton, then the notes newest first', async () => {
    renderApp()

    expect(screen.getByText('Loading notes…')).toBeInTheDocument()

    const rows = await within(await screen.findByRole('list', { name: 'Notes' })).findAllByRole('button')
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Sprint planning'),
      expect.stringContaining('API conventions'),
      expect.stringContaining('Retro notes'),
    ])
    expect(screen.queryByText('Loading notes…')).not.toBeInTheDocument()
  })

  it('shows "No notes yet" when there are none', async () => {
    server.use(http.get(apiUrl('/notes'), () => HttpResponse.json({ notes: [] })))
    renderApp()

    expect(await screen.findByRole('heading', { name: 'No notes yet' })).toBeInTheDocument()
  })

  it('shows an error with Retry, and recovers when Retry succeeds', async () => {
    server.use(
      http.get(apiUrl('/notes'), () => apiError(500, 'internal', 'Something went wrong. Please try again.'), {
        once: true,
      }),
    )
    const { user } = renderApp()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("Couldn't load notes")
    expect(alert).toHaveTextContent('Something went wrong. Please try again.')

    await user.click(within(alert).getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('button', { name: 'Sprint planning' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('search', () => {
  it('filters the list, shows "no results", and clears with Esc', async () => {
    const { user } = renderApp()
    await screen.findByRole('button', { name: 'Sprint planning' })
    const searchBox = screen.getByRole('searchbox', { name: 'Search notes' })

    await user.type(searchBox, 'retro')
    await waitFor(() => expect(within(list()).getAllByRole('button')).toHaveLength(1))
    expect(within(list()).getByRole('button', { name: 'Retro notes' })).toBeInTheDocument()

    await user.clear(searchBox)
    await user.type(searchBox, 'kubernetes')
    expect(await screen.findByRole('heading', { name: 'No notes match "kubernetes"' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(searchBox).toHaveValue('')
    await waitFor(() => expect(within(list()).getAllByRole('button')).toHaveLength(3))
  })

  it('clears from the "no results" state with Clear search', async () => {
    const { user } = renderApp()
    await screen.findByRole('button', { name: 'Sprint planning' })

    await user.type(screen.getByRole('searchbox', { name: 'Search notes' }), 'zzz')
    const empty = await screen.findByRole('heading', { name: 'No notes match "zzz"' })
    await user.click(within(empty.parentElement ?? document.body).getByRole('button', { name: 'Clear search' }))

    expect(await screen.findByRole('button', { name: 'Sprint planning' })).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Search notes' })).toHaveValue('')
  })

  it('focuses the search box with "/"', async () => {
    const { user } = renderApp()
    await screen.findByRole('button', { name: 'Sprint planning' })

    await user.keyboard('/')

    expect(screen.getByRole('searchbox', { name: 'Search notes' })).toHaveFocus()
    expect(screen.getByRole('searchbox', { name: 'Search notes' })).toHaveValue('')
  })
})

describe('selecting a note', () => {
  it('asks you to pick a note when none is selected', async () => {
    renderApp()

    expect(within(detail()).getByRole('heading', { name: 'Select a note' })).toBeInTheDocument()
  })

  it('opens a note on click and puts its id in the URL', async () => {
    const { user } = renderApp()

    await user.click(await screen.findByRole('button', { name: 'API conventions' }))

    expect(within(detail()).getByRole('heading', { level: 2, name: 'API conventions' })).toBeInTheDocument()
    expect(within(detail()).getByText('One error shape for every endpoint.')).toBeInTheDocument()
    expect(noteParam()).toBe('n2')
    expect(screen.getByRole('button', { name: 'API conventions' })).toHaveAttribute('aria-current', 'true')
  })

  it('moves between notes with the arrow keys and opens one with Enter', async () => {
    const { user } = renderApp()
    const first = await screen.findByRole('button', { name: 'Sprint planning' })

    first.focus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('button', { name: 'API conventions' })).toHaveFocus()
    await user.keyboard('{ArrowDown}{ArrowDown}') // stops at the last note
    expect(screen.getByRole('button', { name: 'Retro notes' })).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    await user.keyboard('{Enter}')

    expect(noteParam()).toBe('n2')
    expect(within(detail()).getByRole('heading', { level: 2, name: 'API conventions' })).toBeInTheDocument()
  })

  it('shows the note tags read-only, and clicking one searches for it', async () => {
    const { user } = renderApp('/?note=n2')
    await within(detail()).findByRole('heading', { level: 2, name: 'API conventions' })

    const tagInput = detail().querySelector('tag-input')
    if (!tagInput?.shadowRoot) throw new Error('no <tag-input> in the note')
    const tags = within(tagInput.shadowRoot as unknown as HTMLElement)
    expect(tags.queryByRole('textbox')).not.toBeInTheDocument()

    await user.click(tags.getByRole('button', { name: 'go' }))

    expect(screen.getByRole('searchbox', { name: 'Search notes' })).toHaveValue('go')
    await waitFor(() => expect(within(list()).getAllByRole('button')).toHaveLength(2))
  })

  it('opens the note from the URL on load', async () => {
    renderApp('/?note=n3')

    expect(await within(detail()).findByRole('heading', { level: 2, name: 'Retro notes' })).toBeInTheDocument()
  })

  it('shows "Note not found" for an unknown id, with a way back', async () => {
    const { user } = renderApp('/?note=missing')

    expect(await within(detail()).findByRole('heading', { name: 'Note not found' })).toBeInTheDocument()
    await user.click(within(detail()).getByRole('button', { name: 'Back to notes' }))

    expect(noteParam()).toBeNull()
    expect(within(detail()).getByRole('heading', { name: 'Select a note' })).toBeInTheDocument()
  })

  it('shows an error with Retry when the note fails to load', async () => {
    server.use(
      http.get(apiUrl('/notes'), () => HttpResponse.json({ notes: [] })),
      http.get(apiUrl('/notes/:id'), () => apiError(500, 'internal', 'Something went wrong. Please try again.'), {
        once: true,
      }),
    )
    const { user } = renderApp('/?note=n1')

    const alert = await within(detail()).findByRole('alert')
    expect(alert).toHaveTextContent("Couldn't load this note")
    await user.click(within(alert).getByRole('button', { name: 'Retry' }))

    expect(await within(detail()).findByRole('heading', { level: 2, name: 'Sprint planning' })).toBeInTheDocument()
  })

  it('goes back to the list with the Back button and the browser Back button', async () => {
    const { user } = renderApp()
    await user.click(await screen.findByRole('button', { name: 'Retro notes' }))
    expect(noteParam()).toBe('n3')

    await user.click(within(detail()).getByRole('button', { name: 'Back' }))
    expect(noteParam()).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Sprint planning' }))
    window.history.back()
    await waitFor(() => expect(noteParam()).toBeNull())
    expect(within(detail()).getByRole('heading', { name: 'Select a note' })).toBeInTheDocument()
  })
})
