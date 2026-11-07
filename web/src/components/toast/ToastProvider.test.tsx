import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useToast } from './toast-context'
import { ToastProvider } from './ToastProvider'

function Trigger() {
  const toast = useToast()
  return (
    <>
      <button type="button" onClick={() => toast.success('Saved.')}>
        success
      </button>
      <button type="button" onClick={() => toast.error('It failed.')}>
        error
      </button>
    </>
  )
}

function renderToasts() {
  render(
    <ToastProvider>
      <Trigger />
    </ToastProvider>,
  )
}

describe('ToastProvider', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('announces success as a status and errors as an alert', () => {
    renderToasts()

    fireEvent.click(screen.getByRole('button', { name: 'success' }))
    fireEvent.click(screen.getByRole('button', { name: 'error' }))

    expect(screen.getByRole('status')).toHaveTextContent('Saved.')
    expect(screen.getByRole('alert')).toHaveTextContent('It failed.')
    expect(screen.getByRole('region', { name: 'Notifications' })).toHaveAttribute('aria-live', 'polite')
  })

  it('removes a toast with its dismiss button', () => {
    renderToasts()
    fireEvent.click(screen.getByRole('button', { name: 'success' }))

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('hides success after 4 s and errors after 8 s', () => {
    vi.useFakeTimers()
    renderToasts()
    fireEvent.click(screen.getByRole('button', { name: 'success' }))
    fireEvent.click(screen.getByRole('button', { name: 'error' }))

    act(() => vi.advanceTimersByTime(4_000))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()

    act(() => vi.advanceTimersByTime(4_000))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('pauses while hovered and resumes with the time that was left', () => {
    vi.useFakeTimers()
    renderToasts()
    fireEvent.click(screen.getByRole('button', { name: 'error' }))

    act(() => vi.advanceTimersByTime(5_000))
    fireEvent.mouseEnter(screen.getByRole('alert'))
    act(() => vi.advanceTimersByTime(60_000))
    expect(screen.getByRole('alert')).toBeInTheDocument()

    fireEvent.mouseLeave(screen.getByRole('alert'))
    act(() => vi.advanceTimersByTime(2_900))
    expect(screen.getByRole('alert')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(100))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('stays while focus is inside it, even after the pointer leaves', () => {
    vi.useFakeTimers()
    renderToasts()
    fireEvent.click(screen.getByRole('button', { name: 'success' }))

    const dismiss = screen.getByRole('button', { name: 'Dismiss notification' })
    act(() => dismiss.focus())
    fireEvent.mouseEnter(screen.getByRole('status'))
    fireEvent.mouseLeave(screen.getByRole('status'))
    act(() => vi.advanceTimersByTime(60_000))
    expect(screen.getByRole('status')).toBeInTheDocument()

    act(() => dismiss.blur())
    act(() => vi.advanceTimersByTime(4_000))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows at most three toasts, dropping the oldest', () => {
    renderToasts()
    const success = screen.getByRole('button', { name: 'success' })

    for (let i = 0; i < 5; i++) fireEvent.click(success)

    expect(screen.getAllByRole('status')).toHaveLength(3)
  })
})
