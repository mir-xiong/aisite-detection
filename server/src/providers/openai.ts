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

function isOpenAIErrorJson(body: unknown): body is { error: { message?: string; type?: string } } {
  const obj = body as { error?: { message?: string } } | undefined
  return Boolean(obj?.error)
}

interface SubTypeProbeResult {
  detected: boolean
  endpointTried: string
  statusCode?: number
  latencyMs?: number
  isAuthError: boolean
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
): Promise<SubTypeProbeResult> {
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
    requestHeaders: maskHeaders(reqHeaders),
    requestBody: body,
    responseBody: response.json ?? response.text,
  }

  if (response.statusCode === 200 && response.json) {
    return { detected: true, endpointTried: url, statusCode: response.statusCode, latencyMs: response.latencyMs, isAuthError: false, trace }
  }

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

  if (response.statusCode === 400 && isOpenAIErrorJson(response.json)) {
    return {
      detected: true,
      endpointTried: url,
      statusCode: response.statusCode,
      latencyMs: response.latencyMs,
      isAuthError: false,
      message: response.json.error.message,
      trace,
    }
  }

  return { detected: false, endpointTried: url, trace, isAuthError: false }
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
    requestHeaders: maskHeaders(reqHeaders),
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
  }, timeoutMs, 'chat probe')

  // Phase 3: Probe Responses API (Codex)
  const codexProbe = await probeSubType(baseUrl, apiKey, RESPONSES_PATH, {
    model: probeModel,
    input: 'hi',
    max_output_tokens: 1,
  }, timeoutMs, 'responses probe')

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
      } else if (probe.statusCode === 200) {
        confidence = models.length > 0 ? 'high' : 'medium'
      } else {
        confidence = 'low'
        errorType = 'bad_request'
      }

      return {
        provider,
        supported: true,
        confidence,
        models,
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
