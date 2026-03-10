export type ProviderKind = 'openai' | 'openai-chat' | 'openai-codex' | 'anthropic' | 'gemini'
export type DetectionConfidence = 'high' | 'medium' | 'low'
export type DetectionErrorType =
  | 'auth'
  | 'not_found'
  | 'bad_request'
  | 'unsupported_format'
  | 'timeout'
  | 'network'
  | 'unknown'

export interface DetectRequest {
  baseUrl: string
  apiKey: string
  timeoutMs?: number
}

export interface DetectOneRequest {
  baseUrl: string
  apiKey: string
  provider: ProviderKind
  timeoutMs?: number
}

export interface RequestTrace {
  provider: ProviderKind
  method: 'GET' | 'POST'
  url: string
  authMode: 'bearer' | 'x-api-key' | 'query-key'
  statusCode?: number
  latencyMs?: number
  note?: string
  requestHeaders?: Record<string, string>
  requestBody?: unknown
  responseBody?: unknown
}

export interface ProviderDetectionResult {
  provider: ProviderKind
  supported: boolean
  confidence: DetectionConfidence
  models: string[]
  endpointTried: string
  statusCode?: number
  latencyMs?: number
  errorType?: DetectionErrorType
  message?: string
  traces: RequestTrace[]
}

export interface DetectResponse {
  ok: boolean
  normalizedBaseUrl: string
  startedAt: string
  finishedAt: string
  results: ProviderDetectionResult[]
}
