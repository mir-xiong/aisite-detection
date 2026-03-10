import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import type { DetectResponse } from '../../shared/detection.js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { registerDetectRoute } from './routes/detect.js'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const webDistDir = path.resolve(currentDir, '../../web/dist')

export function createServer() {
  const app = Fastify()

  app.get('/health', async () => {
    const response: DetectResponse = {
      ok: true,
      normalizedBaseUrl: '',
      startedAt: new Date(0).toISOString(),
      finishedAt: new Date(0).toISOString(),
      results: [],
    }

    return response
  })

  void registerDetectRoute(app)

  void app.register(fastifyStatic, {
    root: webDistDir,
    wildcard: false,
  })

  app.get('/*', async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.code(404).send({ message: 'Not Found' })
    }

    return reply.sendFile('index.html')
  })

  return app
}
