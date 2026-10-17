const API_URL = import.meta.env.DEV ? '' : import.meta.env.VITE_API_URL || 'http://localhost:8787'

export function getToken() { return localStorage.getItem('ledgerly-token') }
export function setToken(token: string | null) {
  if (token) localStorage.setItem('ledgerly-token', token)
  else localStorage.removeItem('ledgerly-token')
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (!(init.body instanceof FormData)) headers.set('content-type', 'application/json')
  const token = getToken()
  if (token) headers.set('authorization', `Bearer ${token}`)
  const response = await fetch(`${API_URL}${path}`, { ...init, headers })
  const result = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`)
  return result
}

export const jsonBody = (value: unknown) => JSON.stringify(value)