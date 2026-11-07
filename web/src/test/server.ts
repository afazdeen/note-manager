import { setupServer } from 'msw/node'
import { handlers } from './handlers'

// Default handlers shared by all tests. Override per test with server.use(...).
export const server = setupServer(...handlers)
