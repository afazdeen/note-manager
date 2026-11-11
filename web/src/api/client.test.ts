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
  it('sends the search text, offset and limit as query parameters, and returns the page', async () => {
    let requested = ''
    server.use(
      http.get(apiUrl('/notes'), ({ request }) => {
        requested = request.url
        return HttpResponse.json({ notes: [], total: 7 })
      }),
    )

    const page = await notesApi.search('go api', 4, 2)

    const params = new URL(requested).searchParams
    expect(Object.fromEntries(params)).toEqual({ search: 'go api', offset: '4', limit: '2' })
    expect(page).toEqual({ notes: [], total: 7 })
  })

  it('leaves out an empty search', async () => {
    let requested = ''
    server.use(
      http.get(apiUrl('/notes'), ({ request }) => {
        requested = request.url
        return HttpResponse.json({ notes: [], total: 0 })
      }),
    )

    await notesApi.search('', 0, 2)

    expect(new URL(requested).searchParams.has('search')).toBe(false)
  })

  it.each([
    ['missing', { notes: [] }],
    ['not a number', { notes: [], total: '3' }],
    ['negative', { notes: [], total: -1 }],
    ['not a whole number', { notes: [], total: 1.5 }],
  ])('rejects a list whose total is %s', async (_case, body) => {
    server.use(http.get(apiUrl('/notes'), () => HttpResponse.json(body)))

    const error = await rejection(notesApi.search('', 0, 2))

    expect(error).toMatchObject({ status: 200, code: 'invalid_response' })
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

    const error = await rejection(notesApi.search('', 0, 2))

    expect(error).toMatchObject({ status: 0, code: 'network_error' })
    expect(error.message).toMatch(/can't reach the server/i)
  })

  it('rejects a success response that is not a note', async () => {
    server.use(http.get(apiUrl('/notes/:id'), () => HttpResponse.json({ id: 'n1', title: 42 })))

    const error = await rejection(notesApi.get('n1'))

    expect(error).toMatchObject({ status: 200, code: 'invalid_response' })
  })

  it('rejects a list whose notes are not in the API shape', async () => {
    server.use(http.get(apiUrl('/notes'), () => HttpResponse.json({ notes: [{ id: 'n1' }], total: 1 })))

    const error = await rejection(notesApi.search('', 0, 2))

    expect(error).toMatchObject({ status: 200, code: 'invalid_response' })
  })

  it('keeps the message of an unknown error code, but reports the code as invalid_response', async () => {
    server.use(
      http.delete(apiUrl('/notes/:id'), () =>
        HttpResponse.json({ error: { code: 'forbidden', message: 'Not allowed.' } }, { status: 403 }),
      ),
    )

    const error = await rejection(notesApi.delete('n1'))

    expect(error).toMatchObject({ status: 403, code: 'invalid_response', message: 'Not allowed.' })
  })

  it('drops field messages that are not strings', async () => {
    server.use(
      http.post(apiUrl('/notes'), () =>
        HttpResponse.json(
          { error: { code: 'validation_failed', message: 'Some fields are invalid.', fields: { title: 'is required', body: 7 } } },
          { status: 422 },
        ),
      ),
    )

    const error = await rejection(notesApi.create({ title: '' }))

    expect(error.fields).toEqual({ title: 'is required' })
  })

  it('keeps the error code and message from the API', async () => {
    server.use(http.delete(apiUrl('/notes/:id'), () => apiError(404, 'not_found', 'Note not found.')))

    const error = await rejection(notesApi.delete('missing'))

    expect(error).toMatchObject({ status: 404, code: 'not_found', message: 'Note not found.' })
  })
})
