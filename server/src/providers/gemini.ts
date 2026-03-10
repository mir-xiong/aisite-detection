import type { ProviderDetectionResult, RequestTrace } from '../../../shared/detection.js'
import { probeJson } from '../lib/http.js'
import { joinUrl, maskHeaders, normalizeBaseUrl } from '../lib/url.js'

const MODEL_PATH = '/v1beta/models'
const FALLBACK_MODEL = 'gemini-1.5-flash'

function stripModelPrefix(name: string): string {
  return name.startsWith('models/') ? name.slice('models/'.length) : name
}

function extractGeminiModels(body: unknown): string[] {
  const payload = body as { models?: Array<{ name?: string }> } | undefined
  return (payload?.models ?? [])
    .map((item) => item.name ?? '')
    .filter((value) => value.length > 0)
    .map(stripModelPrefix)
}

function maskQueryKeyUrl(url: string, apiKey: string): string {
  return url.replace(`key=${encodeURIComponent(apiKey)}`, 'key=***')
}

function pickCheapModel(models: string[]): string {
  if (models.length === 0) return FALLBACK_MODEL
  return models.find((m) => /flash/i.test(m)) ?? models[0]
}

export async function detectGemini(
  baseUrl: string,
  apiKey: string,
  timeoutMs = 5000,
): Promise<ProviderDetectionResult> {
  const traces: RequestTrace[] = []
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  let authMode: 'query-key' | 'bearer' = 'query-key'

  // Phase 1: Try model list with query-key auth
  const listUrl = `${joinUrl(normalizedBaseUrl, MODEL_PATH)}?key=${encodeURIComponent(apiKey)}`
  const maskedListUrl = maskQueryKeyUrl(listUrl, apiKey)
  const queryResponse = await probeJson(listUrl, { method: 'GET', timeoutMs })
  traces.push({
    provider: 'gemini',
    method: 'GET',
    url: maskedListUrl,
    authMode: 'query-key',
    statusCode: queryResponse.statusCode,
    latencyMs: queryResponse.latencyMs,
    requestHeaders: {},
    responseBody: queryResponse.json ?? queryResponse.text,
  })

  if (queryResponse.errorType === 'unsupported_format') {
    return {
      provider: 'gemini',
      supported: false,
      confidence: 'low',
      models: [],
      endpointTried: maskedListUrl,
      statusCode: queryResponse.statusCode,
      latencyMs: queryResponse.latencyMs,
      errorType: 'unsupported_format',
      message: 'Gemini endpoints returned a non-JSON response.',
      traces,
    }
  }

  let models = extractGeminiModels(queryResponse.json)
  let modelListOk = queryResponse.statusCode === 200 && models.length > 0

  // Phase 2: If query-key got 401/403, retry with Bearer auth
  if (!modelListOk && (queryResponse.statusCode === 401 || queryResponse.statusCode === 403)) {
    const bearerUrl = joinUrl(normalizedBaseUrl, MODEL_PATH)
    const bearerHeaders: Record<string, string> = { Authorization: `Bearer ${apiKey}` }
    const bearerResponse = await probeJson(bearerUrl, {
      method: 'GET',
      headers: bearerHeaders,
      timeoutMs,
    })
    traces.push({
      provider: 'gemini',
      method: 'GET',
      url: bearerUrl,
      authMode: 'bearer',
      statusCode: bearerResponse.statusCode,
      latencyMs: bearerResponse.latencyMs,
      requestHeaders: maskHeaders(bearerHeaders),
      responseBody: bearerResponse.json ?? bearerResponse.text,
    })

    if (bearerResponse.errorType === 'unsupported_format') {
      return {
        provider: 'gemini',
        supported: false,
        confidence: 'low',
        models: [],
        endpointTried: bearerUrl,
        statusCode: bearerResponse.statusCode,
        latencyMs: bearerResponse.latencyMs,
        errorType: 'unsupported_format',
        message: 'Gemini endpoints returned a non-JSON response.',
        traces,
      }
    }

    models = extractGeminiModels(bearerResponse.json)
    modelListOk = bearerResponse.statusCode === 200 && models.length > 0
    if (modelListOk) authMode = 'bearer'
  }

  // Phase 3: Probe generateContent with a model from the list
  const probeModel = pickCheapModel(models)
  const genUrl = authMode === 'query-key'
    ? `${joinUrl(normalizedBaseUrl, `${MODEL_PATH}/${probeModel}:generateContent`)}?key=${encodeURIComponent(apiKey)}`
    : joinUrl(normalizedBaseUrl, `${MODEL_PATH}/${probeModel}:generateContent`)
  const maskedGenUrl = authMode === 'query-key' ? maskQueryKeyUrl(genUrl, apiKey) : genUrl
  const genReqHeaders: Record<string, string> = authMode === 'bearer'
    ? { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }
    : { 'content-type': 'application/json' }
  const genReqBody = { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] }

  const genResponse = await probeJson(genUrl, {
    method: 'POST',
    headers: genReqHeaders,
    body: JSON.stringify(genReqBody),
    timeoutMs,
  })
  traces.push({
    provider: 'gemini',
    method: 'POST',
    url: maskedGenUrl,
    authMode,
    statusCode: genResponse.statusCode,
    latencyMs: genResponse.latencyMs,
    note: 'generateContent probe',
    requestHeaders: maskHeaders(genReqHeaders),
    requestBody: genReqBody,
    responseBody: genResponse.json ?? genResponse.text,
  })

  const genBody = genResponse.json as { candidates?: unknown[] } | undefined
  const genOk = genResponse.statusCode === 200 && Array.isArray(genBody?.candidates)

  if (genOk) {
    return {
      provider: 'gemini',
      supported: true,
      confidence: modelListOk ? 'high' : 'low',
      models: modelListOk ? models : [probeModel],
      endpointTried: maskedGenUrl,
      statusCode: genResponse.statusCode,
      latencyMs: genResponse.latencyMs,
      message: modelListOk ? undefined : 'Gemini-compatible generation works, but no standard model list endpoint was found.',
      traces,
    }
  }

  // generateContent failed but model list succeeded → still supported (may be auth issue)
  if (modelListOk) {
    const isAuth = genResponse.statusCode === 401 || genResponse.statusCode === 403
    return {
      provider: 'gemini',
      supported: true,
      confidence: 'medium',
      models,
      endpointTried: maskedGenUrl,
      statusCode: genResponse.statusCode,
      latencyMs: genResponse.latencyMs,
      errorType: isAuth ? 'auth' : 'bad_request',
      message: 'Model list found, but generateContent probe failed.',
      traces,
    }
  }

  return {
    provider: 'gemini',
    supported: false,
    confidence: 'low',
    models: [],
    endpointTried: maskedGenUrl,
    statusCode: genResponse.statusCode,
    latencyMs: genResponse.latencyMs,
    errorType: genResponse.errorType ?? 'unknown',
    message: 'Gemini-compatible endpoints were not detected.',
    traces,
  }
}
