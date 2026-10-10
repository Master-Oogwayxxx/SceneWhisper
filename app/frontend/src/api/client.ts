export const API_BASE = (import.meta as any).env.VITE_API_URL || '/api'

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${API_BASE}${normalizedPath}`
}

export function apiWebSocketUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  if (API_BASE.startsWith('http')) {
    return `${API_BASE.replace(/^http/, 'ws')}${normalizedPath}`
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}${API_BASE}${normalizedPath}`
}
