const API_URL = import.meta.env.VITE_API_URL ?? ''

// Base URL of the API (empty = same origin); downloads link directly to it
export const API_BASE_URL = API_URL

// Session lives in an httpOnly cookie set by the worker
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (!(init.body instanceof FormData)) headers.set('content-type', 'application/json')
  const response = await fetch(`${API_URL}${path}`, { ...init, headers, credentials: 'include' })
  const result = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`)
  return result
}

export const jsonBody = (value: unknown) => JSON.stringify(value)

export const clearLegacyToken = () => localStorage.removeItem('ledgerly-token')
