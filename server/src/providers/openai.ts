import type { DetectionErrorType, ProviderDetectionResult, RequestTrace } from '../../../shared/detection.js'
import { probeJson } from '../lib/http.js'
import { joinUrl, maskHeaders } from '../lib/url.js'

const MODEL_PATH = '/v1/models'
const CHAT_PATH = '/v1/chat/completions'
const RESPONSES_PATH = '/v1/responses'

const FALLBACK_MODEL = 'gpt-4o-mini'

function pickCheapModel(models: string[]): string {
  if (models.length === 0) return FALLBACK_MODEL
  return models.find((m) => /mini|small|nano/i.test(m)) ?? models[0]
}

function isOpenAIErrorJson(body: unknown): body is { error: { message?: string; type?: string; code?: string } } {
  const obj = body as { error?: { message?: string } } | undefined
  return Boolean(obj?.error)
}

interface SubTypeProbeResult {
  detected: boolean
  endpointTried: string
  statusCode?: number
  latencyMs?: number
  isAuthError: boolean
  isPaymentError?: boolean
  isModelError?: boolean
  availableModels?: string[]
  message?: string
  trace: RequestTrace
}

async function probeSubType(
  baseUrl: string,
  apiKey: string,
  path: string,
  body: object,
  timeoutMs: number,
  note: string,
  availableModels: string[] = [],
): Promise<SubTypeProbeResult> {
  const probeModel = (body as { model?: string }).model || FALLBACK_MODEL
  const url = joinUrl(baseUrl, path)
  const reqHeaders = { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }
  const response = await probeJson(url, {
    method: 'POST',
    headers: reqHeaders,
    body: JSON.stringify(body),
    timeoutMs,
  })
  const trace: RequestTrace = {
    provider: 'openai',
    method: 'POST',
    url,
    authMode: 'bearer',
    statusCode: response.statusCode,
    latencyMs: response.latencyMs,
    note,
    requestHeaders: mask_headers(reqHeaders),
    requestBody: body,
    responseBody: response.json ?? response.text,
  }

  if (response.statusCode === 200 && response.json) {
    return { 
      detected: true, 
      endpointTried: url, 
      statusCode: response.statusCode, 
      latencyMs: response.latencyMs, 
      isAuthError: false,
      availableModels,
      trace 
    }
  }

  // Auth errors (401, 403)
  if ((response.statusCode === 401 || response.statusCode === 403) && isOpenAIErrorJson(response.json)) {
    return {
      detected: true,
      endpointTried: url,
      statusCode: response.statusCode,
      latencyMs: response.latencyMs,
      isAuthError: true,
      message: response.json.error.message,
      trace,
    }
  }

  // Payment/credit/limit errors (402, 403, 429) - API exists but payment issue
  if (response.statusCode === 402 || response.statusCode === 403 || response.statusCode === 429) {
    const errorMsg = typeof response.json === 'object' && response.json !== null 
      ? JSON.stringify(response.json) 
      : response.text || ''
    const paymentKeywords = ['credit', 'payment', 'insufficient', 'quota', 'limit', 'rate', 'expired', '到期', '余额', '账户']
    const isPaymentError = paymentKeywords.some(kw => errorMsg.toLowerCase().includes(kw))
    
    if (isPaymentError) {
      const jsonMsg = typeof response.json === 'object' && response.json !== null 
        ? ((response.json as {error?: {message?: string}}).error?.message) 
        : undefined
      return {
        detected: true,
        endpointTried: url,
        statusCode: response.statusCode,
        latencyMs: response.latencyMs,
        isAuthError: false,
        isPaymentError: true,
        message: jsonMsg || `Payment/credit issue: ${errorMsg.slice(0, 100)}`,
        availableModels,
        trace,
      }
    }
  }

  // Model not supported errors (400 with model error) - API exists but model unavailable
  if (response.statusCode === 400 && isOpenAIErrorJson(response.json)) {
    const errorMsg = (response.json.error.message?.toLowerCase() || '') + (response.json.error.code?.toLowerCase() || '')
    const modelKeywords = ['model', 'not supported', 'not found', 'invalid_parameter', 'does not exist', 'unsupported']
    const isModelError = modelKeywords.some(kw => errorMsg.includes(kw))
    
    if (isModelError) {
      const modelHint = availableModels.length > 0 
        ? ` Available models: ${availableModels.slice(0, 5).join(', ')}${availableModels.length > 5 ? '...' : ''}`
        : ' Check /v1/models for available models.'
      return {
        detected: true,
        endpointTried: url,
        statusCode: response.statusCode,
        latencyMs: response.latencyMs,
        isAuthError: false,
        isModelError: true,
        message: `API detected, but model '${probeModel}' not available.${modelHint}`,
        availableModels,
        trace,
      }
    }
    
    // Other 400 errors with OpenAI format
    return {
      detected: true,
      endpointTried: url,
      statusCode: response.statusCode,
      latencyMs: response.latencyMs,
      isAuthError: false,
      message: response.json.error.message,
      availableModels,
      trace,
    }
  }

  return { detected: false, endpointTried: url, trace, isAuthError: false }
}

// Helper to mask sensitive headers
function mask_headers(headers: Record<string, string>): Record<string, string> {
  const masked: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'authorization') {
      masked[key] = value.slice(0, 10) + '***' + value.slice(-4)
    } else {
      masked[key] = value
    }
  }
  return masked
}

export async function detectOpenAI(
  baseUrl: string,
  apiKey: string,
  timeoutMs = 5000,
): Promise<ProviderDetectionResult[]> {
  const reqHeaders = { Authorization: `Bearer ${apiKey}` }

  // Phase 1: Probe model list
  const modelUrl = joinUrl(baseUrl, MODEL_PATH)
  const modelResponse = await probeJson(modelUrl, { headers: reqHeaders, timeoutMs })
  const modelTrace: RequestTrace = {
    provider: 'openai',
    method: 'GET',
    url: modelUrl,
    authMode: 'bearer',
    statusCode: modelResponse.statusCode,
    latencyMs: modelResponse.latencyMs,
    note: 'model list',
    requestHeaders: mask_headers(reqHeaders),
    responseBody: modelResponse.json ?? modelResponse.text,
  }

  let models: string[] = []
  const body = modelResponse.json as { data?: Array<{ id?: string }> } | undefined
  const parsed = body?.data?.map((item) => item.id).filter((value): value is string => Boolean(value)) ?? []

  if (modelResponse.statusCode === 200 && parsed.length > 0) {
    models = parsed
  }

  // Phase 2: Probe Chat Completions
  const probeModel = pickCheapModel(models)
  const chatProbe = await probeSubType(baseUrl, apiKey, CHAT_PATH, {
    model: probeModel,
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 1,
  }, timeoutMs, 'chat probe', models)

  // Phase 3: Probe Responses API (Codex)
  const codexProbe = await probeSubType(baseUrl, apiKey, RESPONSES_PATH, {
    model: probeModel,
    input: 'hi',
    max_output_tokens: 1,
  }, timeoutMs, 'responses probe', models)

  // Phase 4: Build separate results
  function buildResult(
    provider: 'openai-chat' | 'openai-codex',
    probe: SubTypeProbeResult,
  ): ProviderDetectionResult {
    const allTraces = [modelTrace, probe.trace]

    if (probe.detected) {
      let confidence: 'high' | 'medium' | 'low'
      let errorType: DetectionErrorType | undefined

      if (probe.isAuthError) {
        confidence = 'medium'
        errorType = 'auth'
      } else if (probe.isPaymentError) {
        confidence = 'medium'
        errorType = 'payment'
      } else if (probe.isModelError) {
        confidence = 'medium'
        errorType = 'model_not_found'
      } else if (probe.statusCode === 200) {
        confidence = models.length > 0 ? 'high' : 'medium'
      } else {
        confidence = 'medium'
        errorType = 'bad_request'
      }

      return {
        provider,
        supported: true,
        confidence,
        models: probe.availableModels || models,
        endpointTried: probe.endpointTried,
        statusCode: probe.statusCode,
        latencyMs: probe.latencyMs,
        errorType,
        message: probe.message,
        traces: allTraces,
      }
    }

    return {
      provider,
      supported: false,
      confidence: 'low',
      models: [],
      endpointTried: probe.endpointTried,
      errorType: 'unknown',
      message: `${provider === 'openai-chat' ? 'Chat Completions' : 'Responses'} API was not detected.`,
      traces: allTraces,
    }
  }

  return [
    buildResult('openai-chat', chatProbe),
    buildResult('openai-codex', codexProbe),
  ]
}