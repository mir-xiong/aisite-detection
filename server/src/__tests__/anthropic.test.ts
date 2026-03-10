import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('detectAnthropic', () => {
  it('returns supported high confidence when model list and messages succeed', async () => {
    const fetchMock = vi
      .fn()
      // GET /v1/models → 200
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: 'claude-3-5-sonnet-latest' }, { id: 'claude-3-5-haiku-latest' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      // POST /v1/messages → 200 (uses haiku from list)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'msg_1', type: 'message' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )

    vi.stubGlobal('fetch', fetchMock)

    const { detectAnthropic } = await import('../providers/anthropic.js')
    const result = await detectAnthropic('https://example.com', 'sk-test', 1000)

    expect(result.supported).toBe(true)
    expect(result.confidence).toBe('high')
    expect(result.models).toEqual(['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest'])
    expect(result.endpointTried).toBe('https://example.com/v1/messages')
  })

  it('returns supported medium confidence on auth error', async () => {
    const fetchMock = vi
      .fn()
      // GET /v1/models → 404
      .mockResolvedValueOnce(new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } }))
      // POST /v1/messages → 401
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'bad key' } }),
          {
            status: 401,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )

    vi.stubGlobal('fetch', fetchMock)

    const { detectAnthropic } = await import('../providers/anthropic.js')
    const result = await detectAnthropic('https://example.com', 'sk-test', 1000)

    expect(result.supported).toBe(true)
    expect(result.confidence).toBe('medium')
    expect(result.errorType).toBe('auth')
    expect(result.statusCode).toBe(401)
  })

  it('keeps only claude models from a mixed model list', async () => {
    const fetchMock = vi
      .fn()
      // GET /v1/models → 200 with mixed models
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              { id: 'claude-3-7-sonnet-latest' },
              { id: 'text-embedding-3-large' },
              { id: 'claude-3-5-haiku-latest' },
            ],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      // POST /v1/messages → 200
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'msg_1', type: 'message' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )

    vi.stubGlobal('fetch', fetchMock)

    const { detectAnthropic } = await import('../providers/anthropic.js')
    const result = await detectAnthropic('https://example.com', 'sk-test', 1000)

    expect(result.models).toEqual(['claude-3-7-sonnet-latest', 'claude-3-5-haiku-latest'])
  })

  it('returns an empty model list with explanation when no model endpoint exists', async () => {
    const fetchMock = vi
      .fn()
      // GET /v1/models → 404
      .mockResolvedValueOnce(new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } }))
      // POST /v1/messages → 200 (uses fallback model)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'msg_1', type: 'message' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )

    vi.stubGlobal('fetch', fetchMock)

    const { detectAnthropic } = await import('../providers/anthropic.js')
    const result = await detectAnthropic('https://example.com', 'sk-test', 1000)

    expect(result.supported).toBe(true)
    expect(result.models).toEqual([])
    expect(result.message).toContain('No standard Anthropic model-list endpoint was found')
  })
})
