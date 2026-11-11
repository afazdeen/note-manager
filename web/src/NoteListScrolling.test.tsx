import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { App } from './App'
import { apiError, apiUrl, db, pageParams } from './test/handlers'
import { listScroller, ROW_HEIGHT, scrollListTo, setListHeight } from './test/layout'
import { renderWithClient } from './test/render'
import { server } from './test/server'

// The virtual note list with the real App: pages of 2 load as the end of the
// list comes into view, only rows near the view are rendered, and the keyboard
// works across rows that aren't rendered. Sizes come from src/test/layout.ts
// (every row is ROW_HEIGHT px).

/** Adds `count` notes older than the 3 seed notes: "More note 1", "More note 2", … */
function addOlderNotes(count: number): void {
  for (let i = 1; i <= count; i++) {
    const day = String(30 - i).padStart(2, '0')
    db.insert({ id: `m${i}`, title: `More note ${i}`, body: '', tags: [], createdAt: `2026-10-${day}T09:00:00Z` })
  }
}

/** Records the offset of every GET /notes; the default handler still answers. */
function recordPageOffsets(): number[] {
  const offsets: number[] = []
  server.use(
    http.get(apiUrl('/notes'), ({ request }) => {
      offsets.push(pageParams(request).offset)
      return undefined
    }),
  )
  return offsets
}

const list = () => screen.getByRole('list', { name: 'Notes' })
const rows = () => within(list()).getAllByRole('listitem')
const rowTitles = () => rows().map((item) => item.querySelector('[data-note-id] [id$="-title"]')?.textContent)
const rowButton = (title: string) => within(list()).getByRole('button', { name: title })

/** Lets pending requests and renders finish, then checks nothing else was requested. */
async function settle(): Promise<void> {
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
}

function renderApp() {
  const user = userEvent.setup()
  renderWithClient(<App />)
  return { user }
}

beforeEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('infinite scroll', () => {
  it('loads pages only as the end of the list comes into view', async () => {
    addOlderNotes(7) // 10 notes: 5 pages of 2
    setListHeight(2 * ROW_HEIGHT)
    const offsets = recordPageOffsets()
    renderApp()

    // The first page fills the view, and its last row is visible, so one more page loads.
    await waitFor(() => expect(offsets).toEqual([0, 2]))
    await settle()
    expect(offsets).toEqual([0, 2])

    // Scrolling the 4th note into view loads the next page, and no more.
    act(() => scrollListTo(2 * ROW_HEIGHT))
    await waitFor(() => expect(offsets).toEqual([0, 2, 4]))
    await settle()
    expect(offsets).toEqual([0, 2, 4])
  })

  it('shows the whole list once you scroll to the end, and stops asking for more', async () => {
    addOlderNotes(3) // 6 notes: 3 pages
    const offsets = recordPageOffsets()
    renderApp()

    await waitFor(() => expect(rowTitles()).toHaveLength(6))
    await settle()
    expect(offsets).toEqual([0, 2, 4])
    expect(rowTitles()).toEqual([
      'Sprint planning',
      'API conventions',
      'Retro notes',
      'More note 1',
      'More note 2',
      'More note 3',
    ])
  })

  it('renders only the rows near the view, but tells screen readers each row\'s place in the whole list', async () => {
    addOlderNotes(17) // 20 notes
    setListHeight(2 * ROW_HEIGHT)
    renderApp()
    await screen.findByRole('list', { name: 'Notes' })

    // Load every page by scrolling to the end until nothing more comes.
    for (let i = 0; i < 10; i++) {
      act(() => scrollListTo(100 * ROW_HEIGHT))
      await settle()
    }

    const rendered = rows()
    // 2 visible rows plus up to 4 overscan on each side; never all 20.
    expect(rendered.length).toBeLessThanOrEqual(2 + 2 * 4 + 3)
    expect(rendered.at(-1)).toHaveTextContent('More note 17')
    for (const row of rendered) expect(row).toHaveAttribute('aria-setsize', '20')
    expect(rendered.at(-1)).toHaveAttribute('aria-posinset', '20')
    expect(screen.getByText('20 notes')).toBeInTheDocument()
  })

  it('shows a skeleton row while the next page loads', async () => {
    let releasePage: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      releasePage = resolve
    })
    server.use(
      http.get(apiUrl('/notes'), async ({ request }) => {
        if (pageParams(request).offset > 0) await held
        return undefined
      }),
    )
    renderApp()

    expect(await screen.findByText('Loading more notes…')).toBeInTheDocument()
    expect(rowTitles()).toEqual(['Sprint planning', 'API conventions'])

    releasePage()
    await waitFor(() => expect(rowTitles()).toEqual(['Sprint planning', 'API conventions', 'Retro notes']))
    expect(screen.queryByText('Loading more notes…')).not.toBeInTheDocument()
  })

  it('shows "Couldn\'t load more notes" with Retry at the end when a page fails, keeping the loaded notes', async () => {
    // The first next-page request fails; everything else goes to the default handler.
    let failed = false
    server.use(
      http.get(apiUrl('/notes'), ({ request }) => {
        if (failed || pageParams(request).offset === 0) return undefined
        failed = true
        return apiError(500, 'internal', 'Something went wrong. Please try again.')
      }),
    )
    const { user } = renderApp()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("Couldn't load more notes")
    expect(alert).toHaveTextContent('Something went wrong. Please try again.')
    expect(rowTitles()).toEqual(['Sprint planning', 'API conventions'])
    // Only the end-of-list error shows, not the banner for the whole list.
    expect(screen.queryByText("Couldn't load notes")).not.toBeInTheDocument()

    await user.click(within(alert).getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(rowTitles()).toEqual(['Sprint planning', 'API conventions', 'Retro notes']))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('keyboard in the virtual list', () => {
  /** 20 notes, 2 rows tall, every page loaded, focus on the first row. */
  async function longList() {
    addOlderNotes(17)
    setListHeight(2 * ROW_HEIGHT)
    const result = renderApp()
    await screen.findByRole('list', { name: 'Notes' })
    for (let i = 0; i < 10; i++) {
      act(() => scrollListTo(100 * ROW_HEIGHT))
      await settle()
    }
    act(() => scrollListTo(0))
    await settle()
    act(() => rowButton('Sprint planning').focus())
    return result
  }

  it('↓ moves focus to rows that weren\'t rendered, scrolling the list along', async () => {
    const { user } = await longList()
    expect(screen.queryByRole('button', { name: 'More note 10' })).not.toBeInTheDocument()

    // Sprint planning, API conventions, Retro notes, More note 1 … More note 10.
    for (let i = 0; i < 12; i++) await user.keyboard('{ArrowDown}')

    expect(rowButton('More note 10')).toHaveFocus()
    expect(listScroller().scrollTop).toBeGreaterThan(0)
  })

  it('End focuses the last row and Home the first, even though neither was rendered', async () => {
    const { user } = await longList()
    expect(screen.queryByRole('button', { name: 'More note 17' })).not.toBeInTheDocument()

    await user.keyboard('{End}')
    expect(rowButton('More note 17')).toHaveFocus()
    expect(listScroller().scrollTop).toBeGreaterThan(0)

    await user.keyboard('{Home}')
    expect(rowButton('Sprint planning')).toHaveFocus()
    expect(listScroller().scrollTop).toBe(0)
  })

  it('↑ moves back up, and stops at the first row', async () => {
    const { user } = await longList()

    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}')
    expect(rowButton('API conventions')).toHaveFocus()

    await user.keyboard('{ArrowUp}{ArrowUp}')
    expect(rowButton('Sprint planning')).toHaveFocus()
  })

  it('keeps the focused row in the DOM when it is scrolled far away, so Tab still reaches the list', async () => {
    const { user } = await longList()
    const focused = rowButton('Sprint planning')

    act(() => scrollListTo(15 * ROW_HEIGHT))
    await settle()

    expect(focused).toBeInTheDocument()
    expect(focused).toHaveFocus()

    // Tab moves to the row's delete button and back out of the list; Shift+Tab returns to the row.
    await user.tab()
    expect(screen.getByRole('button', { name: 'Delete note Sprint planning' })).toHaveFocus()
    await user.tab({ shift: true })
    expect(focused).toHaveFocus()
  })

  it('Enter opens the focused note after moving to it with the keyboard', async () => {
    const { user } = await longList()

    for (let i = 0; i < 8; i++) await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')

    expect(new URLSearchParams(window.location.search).get('note')).toBe('m6')
    expect(rowButton('More note 6')).toHaveAttribute('aria-current', 'true')
  })

  it('Delete on a row reached with the keyboard asks to delete that note', async () => {
    const { user } = await longList()

    for (let i = 0; i < 10; i++) await user.keyboard('{ArrowDown}')
    await user.keyboard('{Delete}')

    const dialog = screen.getByRole('alertdialog', { name: 'Delete this note?' })
    expect(dialog).toHaveAccessibleDescription(expect.stringContaining('"More note 8"'))
  })
})
