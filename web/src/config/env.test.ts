import { describe, expect, it } from 'vitest'
import { parseEnv } from './env'

describe('parseEnv', () => {
  it('defaults to the local API when unset or blank', () => {
    expect(parseEnv({})).toEqual({ apiBaseUrl: 'http://localhost:8080/api' })
    expect(parseEnv({ VITE_API_BASE_URL: '  ' })).toEqual({ apiBaseUrl: 'http://localhost:8080/api' })
  })

  it('removes trailing slashes', () => {
    expect(parseEnv({ VITE_API_BASE_URL: 'https://notes.example.com/api/' })).toEqual({
      apiBaseUrl: 'https://notes.example.com/api',
    })
  })

  it('rejects relative and non-http URLs', () => {
    expect(() => parseEnv({ VITE_API_BASE_URL: '/api' })).toThrow(/absolute/)
    expect(() => parseEnv({ VITE_API_BASE_URL: 'ftp://example.com/api' })).toThrow(/http or https/)
  })
})
