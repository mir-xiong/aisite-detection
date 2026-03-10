export function normalizeBaseUrl(input: string): string {
  const normalized = input.trim()
  const url = new URL(normalized)

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http/https URLs are supported')
  }

  let pathname = url.pathname.replace(/\/+$/, '')
  pathname = pathname.replace(/\/v1$/, '')
  url.pathname = pathname || ''
  url.search = ''
  url.hash = ''

  return url.toString().replace(/\/$/, '')
}

export function joinUrl(baseUrl: string, path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${normalizeBaseUrl(baseUrl)}${normalizedPath}`
}

export function maskSecret(input: string): string {
  if (input.length <= 4) {
    return '***'
  }

  return `${input.slice(0, 5)}***${input.slice(-2)}`
}

export function maskHeaders(headers: Record<string, string>): Record<string, string> {
  const masked = { ...headers }

  if (masked.Authorization) {
    const parts = masked.Authorization.split(' ')
    if (parts.length === 2) {
      masked.Authorization = `${parts[0]} ${maskSecret(parts[1])}`
    }
  }

  if (masked['x-api-key']) {
    masked['x-api-key'] = maskSecret(masked['x-api-key'])
  }

  return masked
}
