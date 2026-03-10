import { createServer } from './app.js'

const server = createServer()
const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST ?? '0.0.0.0'

server
  .listen({ port, host })
  .catch((error) => {
    server.log.error(error)
    process.exit(1)
  })
