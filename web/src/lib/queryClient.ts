import { QueryClient } from '@tanstack/react-query'
import type { ApiError } from '../api/client'

/** Retry once for network and server errors. 4xx errors won't change on retry. */
export function shouldRetry(failureCount: number, error: ApiError): boolean {
  const isClientError = error.status >= 400 && error.status < 500
  return failureCount < 1 && !isClientError
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        retry: shouldRetry,
        // Agents can change notes over MCP, so refresh when the user comes back.
        refetchOnWindowFocus: true,
      },
    },
  })
}
