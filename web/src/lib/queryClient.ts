import { QueryClient } from '@tanstack/react-query'

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        retry: 1,
        // Agents can change notes over MCP, so refresh when the user comes back.
        refetchOnWindowFocus: true,
      },
    },
  })
}
