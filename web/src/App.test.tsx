import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import { renderWithClient } from './test/render'

describe('App shell', () => {
  it('shows the app name as the page heading', () => {
    renderWithClient(<App />)
    expect(screen.getByRole('heading', { level: 1, name: 'Team Notes' })).toBeInTheDocument()
  })

  it('has a main landmark and a skip link to it', () => {
    renderWithClient(<App />)
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main')
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main')
  })
})
