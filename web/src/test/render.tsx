import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderResult } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { ToastProvider } from '../components/toast/ToastProvider'

/** A fresh client per test with no retries, so error states show at once. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

/** Wraps children in the same providers as main.tsx. Use as renderHook's wrapper. */
export function createWrapper(client: QueryClient = createTestQueryClient()) {
  return function Providers({ children }: Readonly<{ children: ReactNode }>) {
    return (
      <QueryClientProvider client={client}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    )
  }
}

export function renderWithClient(ui: ReactElement): RenderResult {
  return render(ui, { wrapper: createWrapper() })
}
