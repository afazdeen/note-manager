// The only place that reads import.meta.env. Everything else imports `env`.

const DEFAULT_API_BASE_URL = 'http://localhost:8080/api'

export interface AppEnv {
  /** Absolute API base URL without a trailing slash, e.g. http://localhost:8080/api */
  readonly apiBaseUrl: string
}

interface RawEnv {
  readonly VITE_API_BASE_URL?: string
}

/** Validates the raw Vite env. Throws on bad values so misconfiguration fails fast. */
export function parseEnv(raw: RawEnv): AppEnv {
  const value = raw.VITE_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`VITE_API_BASE_URL must be an absolute http(s) URL, got "${value}"`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`VITE_API_BASE_URL must use http or https, got "${value}"`)
  }

  return { apiBaseUrl: url.href.replace(/\/+$/, '') }
}

export const env: AppEnv = parseEnv(import.meta.env)
