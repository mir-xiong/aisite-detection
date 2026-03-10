import { describe, expect, it, vi } from 'vitest'

vi.mock('../providers/openai.js', () => ({
  detectOpenAI: vi.fn(),
}))

vi.mock('../providers/anthropic.js', () => ({
  detectAnthropic: vi.fn(),
}))

vi.mock('../providers/gemini.js', () => ({
  detectGemini: vi.fn(),
}))

describe('detect route helpers', () => {
  it('removes trailing slash from base URL', async () => {
    const { normalizeBaseUrl } = await import('../lib/url.js')

    expect(normalizeBaseUrl('https://example.com/')).toBe('https://example.com')
  })

  it('strips /v1 suffix from base URL', async () => {
    const { normalizeBaseUrl } = await import('../lib/url.js')

    expect(normalizeBaseUrl('https://example.com/v1/')).toBe('https://example.com')
    expect(normalizeBaseUrl('https://example.com/v1')).toBe('https://example.com')
  })

  it('rejects non-http protocols', async () => {
    const { normalizeBaseUrl } = await import('../lib/url.js')

    expect(() => normalizeBaseUrl('ftp://example.com')).toThrow('Only http/https URLs are supported')
  })

  it('classifies aborts as timeout errors', async () => {
    const { classifyProbeError } = await import('../lib/http.js')

    const error = new DOMException('The operation was aborted', 'AbortError')

    expect(classifyProbeError(error)).toBe('timeout')
  })

  it('masks API keys in traces', async () => {
    const { maskSecret } = await import('../lib/url.js')

    expect(maskSecret('sk-1234567890')).toBe('sk-12***90')
    expect(maskSecret('abc')).toBe('***')
  })
})

describe('POST /api/detect', () => {
  it('returns 400 for invalid URLs', async () => {
    const { createServer } = await import('../app.js')
    const app = createServer()

    const response = await app.inject({
      method: 'POST',
      url: '/api/detect',
      payload: { baseUrl: 'ftp://example.com', apiKey: 'secret' },
    })

    expect(response.statusCode).toBe(400)
  })

  it('returns 400 for empty API keys', async () => {
    const { createServer } = await import('../app.js')
    const app = createServer()

    const response = await app.inject({
      method: 'POST',
      url: '/api/detect',
      payload: { baseUrl: 'https://example.com', apiKey: '' },
    })

    expect(response.statusCode).toBe(400)
  })

  it('returns mixed provider results and preserves all entries', async () => {
    const { detectOpenAI } = await import('../providers/openai.js')
    const { detectAnthropic } = await import('../providers/anthropic.js')
    const { detectGemini } = await import('../providers/gemini.js')
    const { createServer } = await import('../app.js')

    vi.mocked(detectOpenAI).mockResolvedValue([
      {
        provider: 'openai-chat',
        supported: true,
        confidence: 'high',
        models: ['gpt-4o-mini'],
        endpointTried: 'https://example.com/chat/completions',
        traces: [],
      },
      {
        provider: 'openai-codex',
        supported: false,
        confidence: 'low',
        models: [],
        endpointTried: 'https://example.com/v1/responses',
        errorType: 'unknown',
        traces: [],
      },
    ])
    vi.mocked(detectAnthropic).mockResolvedValue({
      provider: 'anthropic',
      supported: false,
      confidence: 'low',
      models: [],
      endpointTried: 'https://example.com/messages',
      errorType: 'unknown',
      traces: [],
    })
    vi.mocked(detectGemini).mockResolvedValue({
      provider: 'gemini',
      supported: true,
      confidence: 'medium',
      models: ['gemini-1.5-flash'],
      endpointTried: 'https://example.com/models?key=***',
      traces: [],
    })

    const app = createServer()
    const before = Date.now()
    const response = await app.inject({
      method: 'POST',
      url: '/api/detect',
      payload: { baseUrl: 'https://example.com/', apiKey: 'secret' },
    })
    const after = Date.now()

    expect(response.statusCode).toBe(200)

    const body = response.json()
    expect(body.ok).toBe(true)
    expect(body.normalizedBaseUrl).toBe('https://example.com')
    expect(body.results).toHaveLength(4)
    expect(body.results.map((item: { provider: string }) => item.provider)).toEqual([
      'openai-chat',
      'openai-codex',
      'anthropic',
      'gemini',
    ])
    expect(new Date(body.startedAt).getTime()).toBeLessThanOrEqual(new Date(body.finishedAt).getTime())
    expect(new Date(body.startedAt).getTime()).toBeLessThanOrEqual(after)
    expect(new Date(body.startedAt).getTime()).toBeGreaterThanOrEqual(before)
  })

  it('preserves successful results when one provider times out', async () => {
    const { detectOpenAI } = await import('../providers/openai.js')
    const { detectAnthropic } = await import('../providers/anthropic.js')
    const { detectGemini } = await import('../providers/gemini.js')
    const { createServer } = await import('../app.js')

    vi.mocked(detectOpenAI).mockResolvedValue([
      {
        provider: 'openai-chat',
        supported: true,
        confidence: 'high',
        models: ['gpt-4o-mini'],
        endpointTried: 'https://example.com/chat/completions',
        traces: [],
      },
      {
        provider: 'openai-codex',
        supported: true,
        confidence: 'high',
        models: ['gpt-4o-mini'],
        endpointTried: 'https://example.com/responses',
        traces: [],
      },
    ])
    vi.mocked(detectAnthropic).mockResolvedValue({
      provider: 'anthropic',
      supported: false,
      confidence: 'low',
      models: [],
      endpointTried: 'https://example.com/messages',
      errorType: 'timeout',
      message: 'Request timed out',
      traces: [],
    })
    vi.mocked(detectGemini).mockResolvedValue({
      provider: 'gemini',
      supported: false,
      confidence: 'low',
      models: [],
      endpointTried: 'https://example.com/models?key=***',
      errorType: 'unknown',
      traces: [],
    })

    const app = createServer()
    const response = await app.inject({
      method: 'POST',
      url: '/api/detect',
      payload: { baseUrl: 'https://example.com/', apiKey: 'secret' },
    })

    expect(response.statusCode).toBe(200)

    const body = response.json()
    expect(body.results[0].supported).toBe(true)
    expect(body.results[0].provider).toBe('openai-chat')
    expect(body.results[2].errorType).toBe('timeout')
    expect(body.results[3].provider).toBe('gemini')
  })
})
