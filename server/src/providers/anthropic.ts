import type { ProviderDetectionResult, RequestTrace } from '../../../shared/detection.js'
import { probeJson } from '../lib/http.js'
import { joinUrl, maskHeaders } from '../lib/url.js'

const MODEL_PATH = '/v1/models'
const MESSAGE_PATH = '/v1/messages'
const FALLBACK_MODEL = 'claude-3-5-haiku-latest'

function extractAnthropicModels(body: unknown): string[] {
  const candidates = body as { data?: Array<{ id?: string; name?: string }> } | undefined

  return (candidates?.data ?? [])
    .map((item) => item.id ?? item.name ?? '')
    .filter((value): value is string => value.length > 0)
}

function pickCheapModel(models: string[]): string {
  if (models.length === 0) return FALLBACK_MODEL
  return models.find((m) => /haiku/i.test(m)) ?? models[0]
}

export async function detectAnthropic(
  baseUrl: string,
  apiKey: string,
  timeoutMs = 5000,
): Promise<ProviderDetectionResult> {
  const traces: RequestTrace[] = []
  const authHeaders: Record<string, string> = {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  }

  // Phase 1: Try to get model list
  let models: string[] = []

  const modelUrl = joinUrl(baseUrl, MODEL_PATH)
  const modelResponse = await probeJson(modelUrl, {
    method: 'GET',
    headers: authHeaders,
    timeoutMs,
  })
  traces.push({
    provider: 'anthropic',
    method: 'GET',
    url: modelUrl,
    authMode: 'x-api-key',
    statusCode: modelResponse.statusCode,
    latencyMs: modelResponse.latencyMs,
    note: 'model list',
    requestHeaders: maskHeaders(authHeaders),
    responseBody: modelResponse.json ?? modelResponse.text,
  })

  if (modelResponse.statusCode === 200) {
    models = extractAnthropicModels(modelResponse.json)
  }

  // Phase 2: Probe messages endpoint with a model from the list
  const probeModel = pickCheapModel(models)
  const messageUrl = joinUrl(baseUrl, MESSAGE_PATH)
  const msgReqHeaders: Record<string, string> = { ...authHeaders, 'content-type': 'application/json' }
  const msgReqBody = {
    model: probeModel,
    max_tokens: 1,
    messages: [{ role: 'user', content: 'hi' }],
  }

  const msgResponse = await probeJson(messageUrl, {
    method: 'POST',
    headers: msgReqHeaders,
    body: JSON.stringify(msgReqBody),
    timeoutMs,
  })
  traces.push({
    provider: 'anthropic',
    method: 'POST',
    url: messageUrl,
    authMode: 'x-api-key',
    statusCode: msgResponse.statusCode,
    latencyMs: msgResponse.latencyMs,
    requestHeaders: maskHeaders(msgReqHeaders),
    requestBody: msgReqBody,
    responseBody: msgResponse.json ?? msgResponse.text,
  })

  const body = msgResponse.json as
    | { type?: string; error?: { type?: string; message?: string } }
    | undefined

  if (msgResponse.statusCode === 200) {
    return {
      provider: 'anthropic',
      supported: true,
      confidence: 'high',
      models,
      endpointTried: messageUrl,
      statusCode: msgResponse.statusCode,
      latencyMs: msgResponse.latencyMs,
      message: models.length === 0 ? 'No standard Anthropic model-list endpoint was found.' : undefined,
      traces,
    }
  }

  if ((msgResponse.statusCode === 400 || msgResponse.statusCode === 401 || msgResponse.statusCode === 403) && body?.error) {
    return {
      provider: 'anthropic',
      supported: true,
      confidence: 'medium',
      models,
      endpointTried: messageUrl,
      statusCode: msgResponse.statusCode,
      latencyMs: msgResponse.latencyMs,
      errorType: msgResponse.statusCode === 401 || msgResponse.statusCode === 403 ? 'auth' : 'bad_request',
      message: body.error.message,
      traces,
    }
  }

  return {
    provider: 'anthropic',
    supported: false,
    confidence: 'low',
    models: [],
    endpointTried: messageUrl,
    errorType: 'unknown',
    message: 'Anthropic-compatible endpoints were not detected.',
    traces,
  }
}
