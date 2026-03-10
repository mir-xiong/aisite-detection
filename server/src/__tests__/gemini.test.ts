import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('detectGemini', () => {
  it('masks query-key URLs in Gemini results and traces', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ models: [{ name: 'models/gemini-1.5-flash' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    vi.stubGlobal('fetch', fetchMock)

    const { detectGemini } = await import('../providers/gemini.js')
    const result = await detectGemini('https://example.com', 'gem-key', 1000)

    expect(result.supported).toBe(true)
    expect(result.confidence).toBe('high')
    expect(result.models).toEqual(['gemini-1.5-flash'])
    expect(result.endpointTried).toBe('https://example.com/v1beta/models?key=***')
    expect(result.traces[0]?.url).toBe('https://example.com/v1beta/models?key=***')
  })

  it('retries model listing with bearer auth after query-key failure', async () => {
    const fetchMock = vi
      .fn()
      // GET /v1beta/models?key=gem-key → 403
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'forbidden' } }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }),
      )
      // GET /v1beta/models with Bearer → 200
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ models: [{ name: 'models/gemini-1.5-pro' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )

    vi.stubGlobal('fetch', fetchMock)

    const { detectGemini } = await import('../providers/gemini.js')
    const result = await detectGemini('https://example.com', 'gem-key', 1000)

    expect(result.supported).toBe(true)
    expect(result.confidence).toBe('high')
    expect(result.models).toEqual(['gemini-1.5-pro'])
    expect(result.traces).toHaveLength(2)
  })

  it('falls back to generateContent when listing fails', async () => {
    const fetchMock = vi
      .fn()
      // GET /v1beta/models?key=gem-key → 404
      .mockResolvedValueOnce(new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } }))
      // POST /v1beta/models/gemini-1.5-flash:generateContent?key=gem-key → 200
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )

    vi.stubGlobal('fetch', fetchMock)

    const { detectGemini } = await import('../providers/gemini.js')
    const result = await detectGemini('https://example.com', 'gem-key', 1000)

    expect(result.supported).toBe(true)
    expect(result.confidence).toBe('low')
    expect(result.endpointTried).toContain('generateContent')
    expect(result.endpointTried).toContain('key=***')
  })

  it('returns unsupported_format for HTML responses', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response('<html></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    )

    vi.stubGlobal('fetch', fetchMock)

    const { detectGemini } = await import('../providers/gemini.js')
    const result = await detectGemini('https://example.com', 'gem-key', 1000)

    expect(result.supported).toBe(false)
    expect(result.errorType).toBe('unsupported_format')
  })
})
