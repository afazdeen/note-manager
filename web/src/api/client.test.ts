import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { apiError, apiUrl } from '../test/handlers'
import { server } from '../test/server'
import { ApiError, notesApi } from './client'

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  const error: unknown = await promise.then(
    () => {
      throw new Error('expected the call to fail')
    },
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(ApiError)
  return error as ApiError
}

describe('notesApi', () => {
  it('sends the search text as the search query parameter', async () => {
    let requested = ''
    server.use(
      http.get(apiUrl('/notes'), ({ request }) => {
        requested = request.url
        return HttpResponse.json({ notes: [] })
      }),
    )

    await notesApi.search('go api')

    expect(new URL(requested).searchParams.get('search')).toBe('go api')
  })

  it('resolves a 204 delete with no value', async () => {
    await expect(notesApi.delete('n1')).resolves.toBeUndefined()
  })

  it('maps a 422 to an ApiError with field messages', async () => {
    const error = await rejection(notesApi.create({ title: '' }))

    expect(error).toMatchObject({ status: 422, code: 'validation_failed', fields: { title: 'is required' } })
    expect(error.message).toBe('Some fields are invalid.')
  })

  it('maps an error response that is not in the API shape to invalid_response', async () => {
    server.use(http.get(apiUrl('/notes/:id'), () => new HttpResponse('<h1>Bad gateway</h1>', { status: 502 })))

    const error = await rejection(notesApi.get('n1'))

    expect(error).toMatchObject({ status: 502, code: 'invalid_response' })
  })

  it('maps a network failure to network_error with status 0', async () => {
    server.use(http.get(apiUrl('/notes'), () => HttpResponse.error()))

    const error = await rejection(notesApi.search(''))

    expect(error).toMatchObject({ status: 0, code: 'network_error' })
    expect(error.message).toMatch(/can't reach the server/i)
  })

  it('keeps the error code and message from the API', async () => {
    server.use(http.delete(apiUrl('/notes/:id'), () => apiError(404, 'not_found', 'Note not found.')))

    const error = await rejection(notesApi.delete('missing'))

    expect(error).toMatchObject({ status: 404, code: 'not_found', message: 'Note not found.' })
  })
})
