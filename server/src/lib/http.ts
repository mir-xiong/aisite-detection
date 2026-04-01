import type { DetectionErrorType } from '../../../shared/detection.js'

export interface ProbeJsonResult {
  ok: boolean
  statusCode?: number
  headers: Headers
  json?: unknown
  text?: string
  latencyMs: number
  errorType?: DetectionErrorType
}

export interface ProbeJsonOptions {
  method?: 'GET' | 'POST'
  headers?: HeadersInit
  body?: string
  timeoutMs?: number
}

export function classifyProbeError(error: unknown): DetectionErrorType {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'timeout'
  }

  if (error instanceof Error) {
    return 'network'
  }

  return 'unknown'
}

export async function probeJson(url: string, options: ProbeJsonOptions = {}): Promise<ProbeJsonResult> {
  const startedAt = Date.now()
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? 5000
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
      redirect: 'follow',
    })

    const latencyMs = Date.now() - startedAt
    const contentType = response.headers.get('content-type') ?? ''
    const result: ProbeJsonResult = {
      ok: response.ok,
      statusCode: response.status,
      headers: response.headers,
      latencyMs,
    }

    // Try to parse JSON regardless of content-type (some providers don't set proper headers)
    const text = await response.text()
    try {
      result.json = JSON.parse(text)
    } catch {
      // Not valid JSON, store as text
      result.text = text
      if (response.ok) {
        result.errorType = 'unsupported_format'
      }
    }
    return result
  } catch (error) {
    return {
      ok: false,
      headers: new Headers(),
      latencyMs: Date.now() - startedAt,
      errorType: classifyProbeError(error),
    }
  } finally {
    clearTimeout(timeoutId)
  }
}
