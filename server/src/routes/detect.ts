import type { FastifyInstance } from 'fastify'
import type { DetectRequest, DetectOneRequest, DetectResponse, ProviderDetectionResult } from '../../../shared/detection.js'
import { detectAll, detectOne } from '../services/detectAll.js'

export async function registerDetectRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Body: DetectRequest }>('/api/detect', async (request, reply) => {
    const startedAt = new Date().toISOString()
    const baseUrl = request.body?.baseUrl?.trim()
    const apiKey = request.body?.apiKey?.trim()

    if (!baseUrl) {
      return reply.code(400).send({ message: 'baseUrl is required' })
    }

    if (!apiKey) {
      return reply.code(400).send({ message: 'apiKey is required' })
    }

    let result
    try {
      result = await detectAll({
        baseUrl,
        apiKey,
        timeoutMs: request.body?.timeoutMs,
      })
    } catch (error) {
      if (error instanceof Error) {
        return reply.code(400).send({ message: error.message })
      }
      return reply.code(400).send({ message: 'Invalid request' })
    }

    const response: DetectResponse = {
      ok: true,
      normalizedBaseUrl: result.normalizedBaseUrl,
      startedAt,
      finishedAt: new Date().toISOString(),
      results: result.results,
    }

    return reply.code(200).send(response)
  })

  app.post<{ Body: DetectOneRequest }>('/api/detect-one', async (request, reply) => {
    const baseUrl = request.body?.baseUrl?.trim()
    const apiKey = request.body?.apiKey?.trim()
    const provider = request.body?.provider

    if (!baseUrl) {
      return reply.code(400).send({ message: 'baseUrl is required' })
    }

    if (!apiKey) {
      return reply.code(400).send({ message: 'apiKey is required' })
    }

    if (!provider) {
      return reply.code(400).send({ message: 'provider is required' })
    }

    let result: ProviderDetectionResult
    try {
      result = await detectOne({
        baseUrl,
        apiKey,
        provider,
        timeoutMs: request.body?.timeoutMs,
      })
    } catch (error) {
      if (error instanceof Error) {
        return reply.code(400).send({ message: error.message })
      }
      return reply.code(400).send({ message: 'Invalid request' })
    }

    return reply.code(200).send(result)
  })
}
