const API_URL = import.meta.env.VITE_API_URL ?? ''

// Session lives in an httpOnly cookie set by the worker; the Bearer header is
// only sent when a localStorage token from a pre-cookie session still exists.
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (!(init.body instanceof FormData)) headers.set('content-type', 'application/json')
  const legacyToken = localStorage.getItem('ledgerly-token')
  if (legacyToken) headers.set('authorization', `Bearer ${legacyToken}`)
  const response = await fetch(`${API_URL}${path}`, { ...init, headers, credentials: 'include' })
  if (response.status === 401) localStorage.removeItem('ledgerly-token')
  const result = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`)
  return result
}

export const jsonBody = (value: unknown) => JSON.stringify(value)

export const clearLegacyToken = () => localStorage.removeItem('ledgerly-token')
