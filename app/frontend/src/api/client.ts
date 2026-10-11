export const API_BASE = (import.meta as any).env.VITE_API_URL || '/api'

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${API_BASE.replace(/\/+$/, '')}${normalizedPath}`
}

export function apiWebSocketUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const normalizedBase = API_BASE.replace(/\/+$/, '')
  if (API_BASE.startsWith('http')) {
    return `${normalizedBase.replace(/^http/, 'ws')}${normalizedPath}`
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}${normalizedBase}${normalizedPath}`
}
