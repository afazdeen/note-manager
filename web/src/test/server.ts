import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { env } from '../config/env'

/** Builds a full API URL for MSW handlers, e.g. apiUrl('/notes'). */
export const apiUrl = (path: string): string => `${env.apiBaseUrl}${path}`

// Default handlers shared by all tests. Override per test with server.use(...).
export const handlers = [http.get(apiUrl('/health'), () => HttpResponse.json({ status: 'ok' }))]

export const server = setupServer(...handlers)
