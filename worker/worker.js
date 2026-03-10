// ==================== URL Utilities ====================

function normalizeBaseUrl(input) {
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

function joinUrl(baseUrl, path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${normalizeBaseUrl(baseUrl)}${normalizedPath}`
}

function maskSecret(input) {
  if (input.length <= 4) return '***'
  return `${input.slice(0, 5)}***${input.slice(-2)}`
}

function maskHeaders(headers) {
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

// ==================== HTTP Probe ====================

function classifyProbeError(error) {
  if (error instanceof DOMException && error.name === 'AbortError') return 'timeout'
  if (error instanceof Error) return 'network'
  return 'unknown'
}

async function probeJson(url, options = {}) {
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
    const result = {
      ok: response.ok,
      statusCode: response.status,
      headers: response.headers,
      latencyMs,
    }

    if (contentType.includes('application/json')) {
      result.json = await response.json()
      return result
    }

    result.text = await response.text()
    if (response.ok) {
      result.errorType = 'unsupported_format'
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

// ==================== OpenAI Detector ====================

const OPENAI_MODEL_PATH = '/v1/models'
const OPENAI_CHAT_PATH = '/v1/chat/completions'
const OPENAI_RESPONSES_PATH = '/v1/responses'
const OPENAI_FALLBACK_MODEL = 'gpt-4o-mini'

function pickCheapModelOpenAI(models) {
  if (models.length === 0) return OPENAI_FALLBACK_MODEL
  return models.find((m) => /mini|small|nano/i.test(m)) ?? models[0]
}

function isOpenAIErrorJson(body) {
  return Boolean(body?.error)
}

async function probeSubType(baseUrl, apiKey, path, body, timeoutMs, note) {
  const url = joinUrl(baseUrl, path)
  const reqHeaders = { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }
  const response = await probeJson(url, {
    method: 'POST',
    headers: reqHeaders,
    body: JSON.stringify(body),
    timeoutMs,
  })
  const trace = {
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

async function detectOpenAI(baseUrl, apiKey, timeoutMs = 5000) {
  const reqHeaders = { Authorization: `Bearer ${apiKey}` }

  // Phase 1: Probe model list
  const modelUrl = joinUrl(baseUrl, OPENAI_MODEL_PATH)
  const modelResponse = await probeJson(modelUrl, { headers: reqHeaders, timeoutMs })
  const modelTrace = {
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

  let models = []
  const body = modelResponse.json
  const parsed = (body?.data ?? []).map((item) => item.id).filter(Boolean)

  if (modelResponse.statusCode === 200 && parsed.length > 0) {
    models = parsed
  }

  // Phase 2: Probe Chat Completions
  const probeModel = pickCheapModelOpenAI(models)
  const chatProbe = await probeSubType(baseUrl, apiKey, OPENAI_CHAT_PATH, {
    model: probeModel,
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 1,
  }, timeoutMs, 'chat probe')

  // Phase 3: Probe Responses API (Codex)
  const codexProbe = await probeSubType(baseUrl, apiKey, OPENAI_RESPONSES_PATH, {
    model: probeModel,
    input: 'hi',
    max_output_tokens: 1,
  }, timeoutMs, 'responses probe')

  // Phase 4: Build separate results
  function buildResult(provider, probe) {
    const allTraces = [modelTrace, probe.trace]

    if (probe.detected) {
      let confidence
      let errorType

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

// ==================== Anthropic Detector ====================

const ANTHROPIC_MODEL_PATH = '/v1/models'
const ANTHROPIC_MESSAGE_PATH = '/v1/messages'
const ANTHROPIC_FALLBACK_MODEL = 'claude-3-5-haiku-latest'

function extractAnthropicModels(body) {
  return (body?.data ?? [])
    .map((item) => item.id ?? item.name ?? '')
    .filter((value) => value.length > 0)
}

function pickCheapModelAnthropic(models) {
  if (models.length === 0) return ANTHROPIC_FALLBACK_MODEL
  return models.find((m) => /haiku/i.test(m)) ?? models[0]
}

async function detectAnthropic(baseUrl, apiKey, timeoutMs = 5000) {
  const traces = []
  const authHeaders = {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  }

  // Phase 1: Try to get model list
  let models = []
  const modelUrl = joinUrl(baseUrl, ANTHROPIC_MODEL_PATH)
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

  // Phase 2: Probe messages endpoint
  const probeModel = pickCheapModelAnthropic(models)
  const messageUrl = joinUrl(baseUrl, ANTHROPIC_MESSAGE_PATH)
  const msgReqHeaders = { ...authHeaders, 'content-type': 'application/json' }
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

  const msgBody = msgResponse.json

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

  if ((msgResponse.statusCode === 400 || msgResponse.statusCode === 401 || msgResponse.statusCode === 403) && msgBody?.error) {
    return {
      provider: 'anthropic',
      supported: true,
      confidence: 'medium',
      models,
      endpointTried: messageUrl,
      statusCode: msgResponse.statusCode,
      latencyMs: msgResponse.latencyMs,
      errorType: msgResponse.statusCode === 401 || msgResponse.statusCode === 403 ? 'auth' : 'bad_request',
      message: msgBody.error.message,
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

// ==================== Gemini Detector ====================

const GEMINI_MODEL_PATH = '/v1beta/models'
const GEMINI_FALLBACK_MODEL = 'gemini-1.5-flash'

function stripModelPrefix(name) {
  return name.startsWith('models/') ? name.slice('models/'.length) : name
}

function extractGeminiModels(body) {
  return (body?.models ?? [])
    .map((item) => item.name ?? '')
    .filter((value) => value.length > 0)
    .map(stripModelPrefix)
}

function maskQueryKeyUrl(url, apiKey) {
  return url.replace(`key=${encodeURIComponent(apiKey)}`, 'key=***')
}

function pickCheapModelGemini(models) {
  if (models.length === 0) return GEMINI_FALLBACK_MODEL
  return models.find((m) => /flash/i.test(m)) ?? models[0]
}

async function detectGemini(baseUrl, apiKey, timeoutMs = 5000) {
  const traces = []
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  let authMode = 'query-key'

  // Phase 1: Try model list with query-key auth
  const listUrl = `${joinUrl(normalizedBaseUrl, GEMINI_MODEL_PATH)}?key=${encodeURIComponent(apiKey)}`
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
    const bearerUrl = joinUrl(normalizedBaseUrl, GEMINI_MODEL_PATH)
    const bearerHeaders = { Authorization: `Bearer ${apiKey}` }
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
  const probeModel = pickCheapModelGemini(models)
  const genUrl = authMode === 'query-key'
    ? `${joinUrl(normalizedBaseUrl, `${GEMINI_MODEL_PATH}/${probeModel}:generateContent`)}?key=${encodeURIComponent(apiKey)}`
    : joinUrl(normalizedBaseUrl, `${GEMINI_MODEL_PATH}/${probeModel}:generateContent`)
  const maskedGenUrl = authMode === 'query-key' ? maskQueryKeyUrl(genUrl, apiKey) : genUrl
  const genReqHeaders = authMode === 'bearer'
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

  const genBody = genResponse.json
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

// ==================== Orchestrator ====================

async function detectAll(request) {
  const normalizedBase = normalizeBaseUrl(request.baseUrl)
  const timeoutMs = request.timeoutMs ?? 8000

  const [openaiResults, anthropicResult, geminiResult] = await Promise.all([
    detectOpenAI(normalizedBase, request.apiKey, timeoutMs),
    detectAnthropic(normalizedBase, request.apiKey, timeoutMs),
    detectGemini(normalizedBase, request.apiKey, timeoutMs),
  ])

  return {
    normalizedBaseUrl: normalizedBase,
    results: [...openaiResults, anthropicResult, geminiResult],
  }
}

async function detectOne(request) {
  const normalizedBase = normalizeBaseUrl(request.baseUrl)
  const timeoutMs = request.timeoutMs ?? 8000

  switch (request.provider) {
    case 'openai-chat': {
      const results = await detectOpenAI(normalizedBase, request.apiKey, timeoutMs)
      return results[0]
    }
    case 'openai-codex': {
      const results = await detectOpenAI(normalizedBase, request.apiKey, timeoutMs)
      return results[1]
    }
    case 'anthropic':
      return detectAnthropic(normalizedBase, request.apiKey, timeoutMs)
    case 'gemini':
      return detectGemini(normalizedBase, request.apiKey, timeoutMs)
    default:
      throw new Error(`Unknown provider: ${request.provider}`)
  }
}

// ==================== Request Handler ====================

async function handleDetect(request) {
  const startedAt = new Date().toISOString()
  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ message: 'Invalid JSON body' }, { status: 400 })
  }

  const baseUrl = body?.baseUrl?.trim()
  const apiKey = body?.apiKey?.trim()

  if (!baseUrl) return Response.json({ message: 'baseUrl is required' }, { status: 400 })
  if (!apiKey) return Response.json({ message: 'apiKey is required' }, { status: 400 })

  let result
  try {
    result = await detectAll({ baseUrl, apiKey, timeoutMs: body.timeoutMs })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request'
    return Response.json({ message }, { status: 400 })
  }

  return Response.json({
    ok: true,
    normalizedBaseUrl: result.normalizedBaseUrl,
    startedAt,
    finishedAt: new Date().toISOString(),
    results: result.results,
  })
}

async function handleDetectOne(request) {
  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ message: 'Invalid JSON body' }, { status: 400 })
  }

  const baseUrl = body?.baseUrl?.trim()
  const apiKey = body?.apiKey?.trim()
  const provider = body?.provider

  if (!baseUrl) return Response.json({ message: 'baseUrl is required' }, { status: 400 })
  if (!apiKey) return Response.json({ message: 'apiKey is required' }, { status: 400 })
  if (!provider) return Response.json({ message: 'provider is required' }, { status: 400 })

  let result
  try {
    result = await detectOne({ baseUrl, apiKey, provider, timeoutMs: body.timeoutMs })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request'
    return Response.json({ message }, { status: 400 })
  }

  return Response.json(result)
}

// ==================== Embedded HTML ====================

function getHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>AI Site Detection</title>
<style>
:root {
  color-scheme: light;
  --page-bg: #f5f6f8;
  --card-bg: #ffffff;
  --text-primary: #1f2329;
  --text-secondary: #5b6472;
  --border-color: #d8dde6;
  --accent-color: #3b82f6;
}
* { box-sizing: border-box; margin: 0; }
body {
  font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: var(--page-bg);
  color: var(--text-primary);
}

/* Layout */
.app-shell { max-width: 880px; margin: 0 auto; padding: 32px 16px 48px; }
.hero-card, .panel-card {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  padding: 24px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.05);
}
.hero-card { margin-bottom: 20px; }
.hero-card h1 { margin: 0 0 8px; }
.hero-card p, .state-card p, .error-card p { color: var(--text-secondary); }
.panel-card + .panel-card { margin-top: 16px; }
.error-card p { color: #c0392b; }
.mt-16 { margin-top: 16px; }

/* Form */
.detect-form { display: grid; gap: 12px; }
.detect-form label { display: grid; gap: 6px; }
.detect-form label > span { font-weight: 500; font-size: 14px; }
.detect-form input, .smart-textarea {
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  font-family: inherit;
  font-size: inherit;
}
.smart-textarea { resize: vertical; width: 100%; }
.smart-input-group { display: grid; gap: 8px; }
.parse-btn {
  width: fit-content;
  padding: 8px 14px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
}
.parse-btn:disabled { cursor: not-allowed; opacity: 0.5; }
.key-input-group { display: flex; gap: 8px; }
.key-input-group input { flex: 1; min-width: 0; }
.toggle-btn {
  padding: 10px 14px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  white-space: nowrap;
}
.submit-btn {
  width: fit-content;
  padding: 10px 18px;
  border: none;
  border-radius: 8px;
  background: var(--accent-color);
  color: #fff;
  cursor: pointer;
  font-size: inherit;
}
.submit-btn:disabled { cursor: not-allowed; opacity: 0.7; }
.field-error { color: #c0392b; font-size: 14px; }

/* Summary */
.summary-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 16px;
}
.summary-label { margin: 0 0 6px; color: var(--text-secondary); font-size: 13px; }
.summary-value { font-weight: 600; }
.tag-list { display: flex; flex-wrap: wrap; gap: 8px; }
.provider-tag {
  padding: 4px 10px;
  border-radius: 999px;
  background: #e8f0ff;
  color: var(--accent-color);
  font-size: 13px;
  font-weight: 600;
}
.summary-muted { color: var(--text-secondary); }

/* Provider Card */
.provider-grid { display: grid; gap: 16px; margin-top: 16px; }
@media (min-width: 720px) {
  .provider-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
.provider-card {
  border: 1px solid var(--border-color);
  border-radius: 16px;
  padding: 20px;
  background: var(--card-bg);
}
.provider-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}
.provider-header h3 { margin: 0; }
.provider-header p { margin: 6px 0 0; color: var(--text-secondary); }
.status-auth-error {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 999px;
  background: #fde8e8;
  color: #c0392b;
  font-weight: 600;
}
.confidence-badge {
  height: fit-content;
  padding: 4px 10px;
  border-radius: 999px;
  background: #f0f3f8;
  color: var(--text-primary);
  text-transform: capitalize;
  font-size: 13px;
}
.provider-meta { display: grid; gap: 12px; margin: 0 0 16px; }
.provider-meta dt { margin-bottom: 4px; color: var(--text-secondary); font-size: 13px; }
.provider-meta dd { margin: 0; word-break: break-all; }
.provider-section { margin-bottom: 16px; }
.section-title { margin: 0 0 8px; font-size: 13px; color: var(--text-secondary); }
.model-list { display: flex; flex-wrap: wrap; gap: 8px; }
.model-pill { padding: 4px 10px; border-radius: 999px; background: #f0f3f8; font-size: 13px; }
.provider-message { color: var(--text-secondary); }
.header-actions {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.trace-button, .redetect-btn {
  padding: 10px 14px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
}
.redetect-btn {
  padding: 6px 12px;
  font-size: 13px;
  white-space: nowrap;
}
.redetect-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

/* Drawer */
.drawer-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.35);
  display: flex;
  justify-content: flex-end;
  z-index: 30;
}
.drawer-panel {
  width: min(520px, 100%);
  height: 100%;
  background: var(--card-bg);
  padding: 24px;
  overflow-y: auto;
}
.drawer-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}
.drawer-header h3 { margin: 0; }
.drawer-header p { margin-top: 6px; color: var(--text-secondary); }
.drawer-close {
  height: fit-content;
  padding: 8px 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
}
.trace-list { display: grid; gap: 12px; padding: 0; list-style: none; }
.trace-item {
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 14px;
}
.trace-summary {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
.trace-summary p { margin: 0; color: var(--text-secondary); font-size: 13px; }
.trace-summary p + p { margin-top: 4px; }
.trace-summary p:first-child { color: var(--text-primary); font-size: 14px; }
.trace-note { font-style: italic; }
.detail-btn {
  flex-shrink: 0;
  padding: 4px 10px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: transparent;
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.trace-detail { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border-color); }
.detail-section + .detail-section { margin-top: 12px; }
.detail-title {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.detail-pre {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: #f5f7fa;
  font-size: 12px;
  line-height: 1.5;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
.hidden { display: none !important; }
</style>
</head>
<body>
<main class="app-shell">
  <section class="hero-card">
    <h1>AI Site Detection</h1>
    <p>Check whether a gateway supports OpenAI, Anthropic, or Gemini-compatible APIs.</p>
  </section>

  <section class="panel-card">
    <div class="detect-form">
      <div class="smart-input-group">
        <label>
          <span>Smart Paste</span>
          <textarea id="smartInput" class="smart-textarea" rows="2"
            placeholder="Paste text containing URL and API key, e.g.: https://api.example.com sk-proj-abc123..."></textarea>
        </label>
        <button type="button" class="parse-btn" id="parseBtn" disabled>Extract</button>
      </div>

      <label>
        <span>Base URL</span>
        <input id="baseUrl" type="url" />
      </label>
      <p id="baseUrlError" class="field-error hidden"></p>

      <label>
        <span>API Key</span>
        <div class="key-input-group">
          <input id="apiKey" type="password" />
          <button type="button" class="toggle-btn" id="toggleKey">Show</button>
        </div>
      </label>
      <p id="apiKeyError" class="field-error hidden"></p>

      <label>
        <span>Timeout (ms)</span>
        <input id="timeoutMs" type="number" value="8000" min="1000" step="1000" />
      </label>

      <button type="button" class="submit-btn" id="detectBtn">Detect</button>
    </div>
  </section>

  <section class="panel-card state-card mt-16" id="loadingCard">
    <p>Running provider checks\u2026</p>
  </section>

  <section class="panel-card error-card mt-16" id="errorCard">
    <p id="errorText"></p>
  </section>

  <section class="panel-card mt-16" id="summaryCard"></section>

  <section class="panel-card state-card mt-16" id="noSupportCard">
    <p>No compatible provider was detected. Review the provider cards for details.</p>
  </section>

  <section class="provider-grid" id="providerGrid"></section>

  <section class="panel-card state-card" id="idleCard">
    <p>Enter a base URL and API key to begin detection.</p>
  </section>
</main>

<!-- Drawer -->
<div class="drawer-backdrop hidden" id="drawerBackdrop">
  <aside class="drawer-panel">
    <header class="drawer-header">
      <div>
        <h3 id="drawerTitle"></h3>
        <p>Masked request metadata</p>
      </div>
      <button type="button" class="drawer-close" id="drawerClose">Close</button>
    </header>
    <ul class="trace-list" id="traceList"></ul>
  </aside>
</div>

<script>
(function () {
  const PROVIDER_LABELS = {
    'openai-chat': 'OpenAI Chat',
    'openai-codex': 'OpenAI Codex',
    anthropic: 'Anthropic',
    gemini: 'Gemini',
  };

  // DOM refs
  const $smartInput = document.getElementById('smartInput');
  const $parseBtn = document.getElementById('parseBtn');
  const $baseUrl = document.getElementById('baseUrl');
  const $apiKey = document.getElementById('apiKey');
  const $timeoutMs = document.getElementById('timeoutMs');
  const $toggleKey = document.getElementById('toggleKey');
  const $detectBtn = document.getElementById('detectBtn');
  const $baseUrlError = document.getElementById('baseUrlError');
  const $apiKeyError = document.getElementById('apiKeyError');

  const $loadingCard = document.getElementById('loadingCard');
  const $errorCard = document.getElementById('errorCard');
  const $errorText = document.getElementById('errorText');
  const $summaryCard = document.getElementById('summaryCard');
  const $noSupportCard = document.getElementById('noSupportCard');
  const $providerGrid = document.getElementById('providerGrid');
  const $idleCard = document.getElementById('idleCard');

  const $drawerBackdrop = document.getElementById('drawerBackdrop');
  const $drawerTitle = document.getElementById('drawerTitle');
  const $drawerClose = document.getElementById('drawerClose');
  const $traceList = document.getElementById('traceList');

  let currentResult = null;

  // --- Helpers ---
  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }
  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
  function formatJson(value) {
    if (value === undefined || value === null) return '\\u2014';
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value, null, 2); } catch { return String(value); }
  }

  // --- Smart Paste ---
  function extractSiteAndKey(text) {
    const result = { baseUrl: '', apiKey: '' };
    const trimmed = text.trim();
    if (!trimmed) return result;

    const urlMatch = trimmed.match(/https?:\\/\\/[^\\s,;'"]+/gi);
    if (urlMatch) result.baseUrl = urlMatch[0].replace(/\\/+$/, '');

    const keyPatterns = [
      /(?:sk-(?:proj-)?[A-Za-z0-9_-]{20,})/,
      /(?:key-[A-Za-z0-9_-]{20,})/,
      /(?:AIzaSy[A-Za-z0-9_-]{33})/,
    ];
    for (const p of keyPatterns) {
      const m = trimmed.match(p);
      if (m) { result.apiKey = m[0]; return result; }
    }

    const remaining = result.baseUrl ? trimmed.replace(result.baseUrl, '').trim() : trimmed;
    const tokens = remaining.split(/[\\s,;=:]+/).filter(Boolean);
    for (const t of tokens) {
      if (t.length >= 16 && /^[A-Za-z0-9_-]+$/.test(t) && !/^https?/i.test(t)) {
        result.apiKey = t;
        break;
      }
    }
    return result;
  }

  $smartInput.addEventListener('input', () => {
    $parseBtn.disabled = !$smartInput.value.trim();
  });

  $parseBtn.addEventListener('click', () => {
    const parsed = extractSiteAndKey($smartInput.value);
    if (parsed.baseUrl) $baseUrl.value = parsed.baseUrl;
    if (parsed.apiKey) $apiKey.value = parsed.apiKey;
    $smartInput.value = '';
    $parseBtn.disabled = true;
  });

  // --- Toggle API Key ---
  $toggleKey.addEventListener('click', () => {
    const isPassword = $apiKey.type === 'password';
    $apiKey.type = isPassword ? 'text' : 'password';
    $toggleKey.textContent = isPassword ? 'Hide' : 'Show';
  });

  // --- State management ---
  function resetUI() {
    hide($loadingCard);
    hide($errorCard);
    hide($summaryCard);
    hide($noSupportCard);
    hide($idleCard);
    $providerGrid.innerHTML = '';
    $providerGrid.classList.add('hidden');
  }

  function showIdle() {
    resetUI();
    show($idleCard);
  }

  function showLoading() {
    resetUI();
    show($loadingCard);
    $detectBtn.disabled = true;
    $detectBtn.textContent = 'Detecting\\u2026';
  }

  function showError(msg) {
    resetUI();
    $errorText.textContent = msg;
    show($errorCard);
  }

  function stopLoading() {
    $detectBtn.disabled = false;
    $detectBtn.textContent = 'Detect';
  }

  // --- Status label ---
  function statusLabel(r) {
    if (r.supported && r.errorType === 'auth') return 'Supported \\u00b7 Key invalid';
    if (r.supported) return 'Supported';
    if (r.errorType === 'auth') return 'Authentication failed';
    if (r.errorType === 'timeout') return 'Timed out';
    if (r.errorType === 'unsupported_format') return 'Unsupported response';
    return 'Not detected';
  }

  // --- Render Summary ---
  function renderSummary(data) {
    const elapsed = Math.max(0, new Date(data.finishedAt) - new Date(data.startedAt));
    const supported = data.results.filter(r => r.supported);
    const tags = supported.length
      ? supported.map(r => '<span class="provider-tag">' + esc(PROVIDER_LABELS[r.provider] || r.provider) + '</span>').join('')
      : '<span class="summary-muted">None</span>';

    $summaryCard.innerHTML =
      '<div class="summary-strip">' +
        '<div><p class="summary-label">Normalized URL</p><p class="summary-value">' + esc(data.normalizedBaseUrl) + '</p></div>' +
        '<div><p class="summary-label">Elapsed</p><p class="summary-value">' + elapsed + ' ms</p></div>' +
        '<div><p class="summary-label">Supported</p><div class="tag-list">' + tags + '</div></div>' +
      '</div>';
    show($summaryCard);
  }

  // --- Render Provider Card ---
  function renderProviderCard(r) {
    const name = PROVIDER_LABELS[r.provider] || r.provider;
    const sl = statusLabel(r);
    const isAuthErr = r.supported && r.errorType === 'auth';
    const statusClass = isAuthErr ? ' status-auth-error' : '';

    let modelsHtml;
    if (r.models.length) {
      modelsHtml = '<div class="model-list">' + r.models.map(m => '<span class="model-pill">' + esc(m) + '</span>').join('') + '</div>';
    } else {
      modelsHtml = '<p class="provider-message">' + esc(r.message || 'No models reported.') + '</p>';
    }

    const msgHtml = (r.message && r.models.length) ? '<p class="provider-message">' + esc(r.message) + '</p>' : '';

    const card = document.createElement('article');
    card.className = 'provider-card';
    card.dataset.provider = r.provider;
    card.innerHTML =
      '<header class="provider-header">' +
        '<div><h3>' + esc(name) + '</h3><p class="' + statusClass + '">' + esc(sl) + '</p></div>' +
        '<div class="header-actions">' +
          '<button type="button" class="redetect-btn">Re-detect</button>' +
          '<span class="confidence-badge">' + esc(r.confidence) + '</span>' +
        '</div>' +
      '</header>' +
      '<dl class="provider-meta">' +
        '<div><dt>Endpoint</dt><dd>' + esc(r.endpointTried || '\\u2014') + '</dd></div>' +
        '<div><dt>Status</dt><dd>' + (r.statusCode ?? '\\u2014') + '</dd></div>' +
      '</dl>' +
      '<div class="provider-section">' +
        '<p class="section-title">Models</p>' +
        modelsHtml +
      '</div>' +
      msgHtml +
      '<button type="button" class="trace-button">View trace</button>';

    card.querySelector('.trace-button').addEventListener('click', () => openDrawer(r));
    card.querySelector('.redetect-btn').addEventListener('click', () => redetectProvider(r.provider, card));
    return card;
  }

  // --- Render Results ---
  function showResults(data) {
    resetUI();
    currentResult = data;
    renderSummary(data);

    const hasSupport = data.results.some(r => r.supported);
    if (!hasSupport) show($noSupportCard);

    $providerGrid.innerHTML = '';
    data.results.forEach(r => $providerGrid.appendChild(renderProviderCard(r)));
    $providerGrid.classList.remove('hidden');
  }

  // --- Re-detect Single Provider ---
  async function redetectProvider(provider, cardEl) {
    const btn = cardEl.querySelector('.redetect-btn');
    const originalText = btn.textContent;
    btn.textContent = 'Detecting…';
    btn.disabled = true;

    try {
      const res = await fetch('/api/detect-one', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseUrl: $baseUrl.value.trim(),
          apiKey: $apiKey.value.trim(),
          provider,
          timeoutMs: parseInt($timeoutMs.value, 10) || 8000,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Re-detection failed');
      }

      const updatedResult = await res.json();

      // Update currentResult
      const idx = currentResult.results.findIndex(r => r.provider === provider);
      if (idx !== -1) {
        currentResult.results[idx] = updatedResult;
      }

      // Re-render this card
      const newCard = renderProviderCard(updatedResult);
      cardEl.replaceWith(newCard);

      // Refresh summary
      renderSummary(currentResult);

      // Update no-support card visibility
      const hasSupport = currentResult.results.some(r => r.supported);
      if (hasSupport) {
        hide($noSupportCard);
      } else {
        show($noSupportCard);
      }
    } catch (err) {
      alert(err.message || 'Re-detection failed');
      btn.textContent = originalText;
      btn.disabled = false;
    }
  }

  // --- Drawer ---
  function openDrawer(r) {
    const name = PROVIDER_LABELS[r.provider] || r.provider;
    $drawerTitle.textContent = name + ' trace';
    $traceList.innerHTML = '';
    const expandedSet = new Set();

    (r.traces || []).forEach((trace, idx) => {
      const li = document.createElement('li');
      li.className = 'trace-item';

      function renderLi() {
        const expanded = expandedSet.has(idx);
        let detailHtml = '';
        if (expanded) {
          detailHtml = '<div class="trace-detail">';
          if (trace.requestHeaders && Object.keys(trace.requestHeaders).length) {
            detailHtml += '<div class="detail-section"><p class="detail-title">Request Headers</p><pre class="detail-pre">' + esc(formatJson(trace.requestHeaders)) + '</pre></div>';
          }
          if (trace.requestBody) {
            detailHtml += '<div class="detail-section"><p class="detail-title">Request Body</p><pre class="detail-pre">' + esc(formatJson(trace.requestBody)) + '</pre></div>';
          }
          detailHtml += '<div class="detail-section"><p class="detail-title">Response Body</p><pre class="detail-pre">' + esc(formatJson(trace.responseBody)) + '</pre></div>';
          detailHtml += '</div>';
        }

        li.innerHTML =
          '<div class="trace-summary">' +
            '<div>' +
              '<p><strong>' + esc(trace.method) + '</strong> ' + esc(trace.url) + '</p>' +
              '<p>Status: ' + (trace.statusCode ?? '\\u2014') + ' \\u00b7 Auth: ' + esc(trace.authMode) + ' \\u00b7 ' + (trace.latencyMs ?? '\\u2014') + ' ms</p>' +
              (trace.note ? '<p class="trace-note">' + esc(trace.note) + '</p>' : '') +
            '</div>' +
            '<button type="button" class="detail-btn">' + (expanded ? 'Hide' : 'Details') + '</button>' +
          '</div>' +
          detailHtml;

        li.querySelector('.detail-btn').addEventListener('click', () => {
          if (expandedSet.has(idx)) expandedSet.delete(idx); else expandedSet.add(idx);
          renderLi();
        });
      }

      renderLi();
      $traceList.appendChild(li);
    });

    show($drawerBackdrop);
  }

  function closeDrawer() {
    hide($drawerBackdrop);
  }

  $drawerClose.addEventListener('click', closeDrawer);
  $drawerBackdrop.addEventListener('click', (e) => {
    if (e.target === $drawerBackdrop) closeDrawer();
  });

  // --- Detect ---
  $detectBtn.addEventListener('click', async () => {
    const baseUrl = $baseUrl.value.trim();
    const apiKey = $apiKey.value.trim();

    // Validate
    let hasErr = false;
    if (!baseUrl) { $baseUrlError.textContent = 'Base URL is required'; show($baseUrlError); hasErr = true; }
    else { hide($baseUrlError); }
    if (!apiKey) { $apiKeyError.textContent = 'API key is required'; show($apiKeyError); hasErr = true; }
    else { hide($apiKeyError); }
    if (hasErr) return;

    showLoading();

    try {
      const res = await fetch('/api/detect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseUrl,
          apiKey,
          timeoutMs: parseInt($timeoutMs.value, 10) || 8000,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Detection failed');
      showResults(data);
    } catch (err) {
      showError(err.message || 'Detection failed');
    } finally {
      stopLoading();
    }
  });

  // Init
  hide($loadingCard);
  hide($errorCard);
  hide($summaryCard);
  hide($noSupportCard);
  hide($drawerBackdrop);
  $providerGrid.classList.add('hidden');
  show($idleCard);
})();
</script>
</body>
</html>`;
}

// ==================== Worker Entry ====================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '')) {
      return new Response(getHtml(), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    }

    if (request.method === 'POST' && url.pathname === '/api/detect') {
      return handleDetect(request)
    }

    if (request.method === 'POST' && url.pathname === '/api/detect-one') {
      return handleDetectOne(request)
    }

    return new Response('Not Found', { status: 404 })
  },
}
