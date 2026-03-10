import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('detectOpenAI', () => {
  it('returns chat supported and codex not detected', async () => {
    const fetchMock = vi
      .fn()
      // GET /v1/models → 200
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: 'gpt-4o-mini' }, { id: 'gpt-4.1' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      // POST /v1/chat/completions → 200
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'chatcmpl-1', choices: [{ message: { content: 'hi' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      // POST /v1/responses → 404
      .mockResolvedValueOnce(new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } }))

    vi.stubGlobal('fetch', fetchMock)

    const { detectOpenAI } = await import('../providers/openai.js')
    const results = await detectOpenAI('https://example.com', 'sk-test', 1000)

    expect(results).toHaveLength(2)

    const chat = results.find((r) => r.provider === 'openai-chat')!
    expect(chat.supported).toBe(true)
    expect(chat.confidence).toBe('high')
    expect(chat.models).toEqual(['gpt-4o-mini', 'gpt-4.1'])
    expect(chat.endpointTried).toBe('https://example.com/v1/chat/completions')

    const codex = results.find((r) => r.provider === 'openai-codex')!
    expect(codex.supported).toBe(false)
  })

  it('returns both auth errors when probes return 401', async () => {
    const fetchMock = vi
      .fn()
      // GET /v1/models → 401
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'bad key', type: 'invalid_api_key' } }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      )
      // POST /v1/chat/completions → 401
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'bad key' } }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      )
      // POST /v1/responses → 401
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'bad key' } }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      )

    vi.stubGlobal('fetch', fetchMock)

    const { detectOpenAI } = await import('../providers/openai.js')
    const results = await detectOpenAI('https://example.com', 'sk-test', 1000)

    const chat = results.find((r) => r.provider === 'openai-chat')!
    expect(chat.supported).toBe(true)
    expect(chat.confidence).toBe('medium')
    expect(chat.errorType).toBe('auth')

    const codex = results.find((r) => r.provider === 'openai-codex')!
    expect(codex.supported).toBe(true)
    expect(codex.confidence).toBe('medium')
    expect(codex.errorType).toBe('auth')
  })

  it('detects chat via error response when model list fails', async () => {
    const fetchMock = vi
      .fn()
      // GET /v1/models → 404
      .mockResolvedValueOnce(new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } }))
      // POST /v1/chat/completions → 400 with OpenAI error
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'unknown model', type: 'invalid_request_error' } }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
      )
      // POST /v1/responses → 404
      .mockResolvedValueOnce(new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } }))

    vi.stubGlobal('fetch', fetchMock)

    const { detectOpenAI } = await import('../providers/openai.js')
    const results = await detectOpenAI('https://example.com', 'sk-test', 1000)

    const chat = results.find((r) => r.provider === 'openai-chat')!
    expect(chat.supported).toBe(true)
    expect(chat.confidence).toBe('low')
    expect(chat.endpointTried).toBe('https://example.com/v1/chat/completions')

    const codex = results.find((r) => r.provider === 'openai-codex')!
    expect(codex.supported).toBe(false)
  })

  it('detects both chat and codex independently', async () => {
    const fetchMock = vi
      .fn()
      // GET /v1/models → 200
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: 'gpt-4o-mini' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      // POST /v1/chat/completions → 200
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'chatcmpl-1', choices: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      // POST /v1/responses → 200
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'resp-1', output: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )

    vi.stubGlobal('fetch', fetchMock)

    const { detectOpenAI } = await import('../providers/openai.js')
    const results = await detectOpenAI('https://example.com', 'sk-test', 1000)

    const chat = results.find((r) => r.provider === 'openai-chat')!
    expect(chat.supported).toBe(true)
    expect(chat.confidence).toBe('high')

    const codex = results.find((r) => r.provider === 'openai-codex')!
    expect(codex.supported).toBe(true)
    expect(codex.confidence).toBe('high')
  })

  it('returns codex only when chat fails', async () => {
    const fetchMock = vi
      .fn()
      // GET /v1/models → 200
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: 'gpt-4o-mini' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      // POST /v1/chat/completions → 404
      .mockResolvedValueOnce(new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } }))
      // POST /v1/responses → 200
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'resp-1', output: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )

    vi.stubGlobal('fetch', fetchMock)

    const { detectOpenAI } = await import('../providers/openai.js')
    const results = await detectOpenAI('https://example.com', 'sk-test', 1000)

    const chat = results.find((r) => r.provider === 'openai-chat')!
    expect(chat.supported).toBe(false)

    const codex = results.find((r) => r.provider === 'openai-codex')!
    expect(codex.supported).toBe(true)
    expect(codex.confidence).toBe('high')
  })
})
