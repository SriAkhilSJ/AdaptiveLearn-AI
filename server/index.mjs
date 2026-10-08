import { createReadStream } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAIProvider } from './providers/index.mjs'
import { createAdaptationService } from './services/adaptation-service.mjs'
import { createQuizService } from './services/quiz-service.mjs'

const serveStatic = process.argv.includes('--serve-static')
const port = Number(serveStatic ? process.env.PORT || 4173 : 8787)
const maxBodyBytes = 1_000_000
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const distDirectory = resolve(root, 'dist')
const provider = createAIProvider()
const adaptationService = createAdaptationService(provider)
const quizService = createQuizService(provider)

class HttpError extends Error {
  constructor(message, statusCode) {
    super(message)
    this.statusCode = statusCode
  }
}

function sendJson(response, statusCode, body) {
  const encoded = Buffer.from(JSON.stringify(body))
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': encoded.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(encoded)
}

async function readJsonBody(request) {
  if (!request.headers['content-type']?.toLowerCase().includes('application/json')) {
    throw new HttpError('Send lesson data as application/json.', 415)
  }

  const chunks = []
  let total = 0
  for await (const chunk of request) {
    total += chunk.length
    if (total > maxBodyBytes) {
      request.resume()
      throw new HttpError('The upload is too large to adapt in one request.', 413)
    }
    chunks.push(chunk)
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError('The request body must be valid JSON.', 400)
  }
}

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

async function serveBuiltApp(request, response, pathname) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendJson(response, 405, { error: 'Method not allowed.' })
    return
  }

  let decodedPath
  try {
    decodedPath = decodeURIComponent(pathname)
  } catch {
    sendJson(response, 400, { error: 'Invalid URL path.' })
    return
  }

  const candidate = resolve(distDirectory, `.${decodedPath}`)
  if (candidate !== distDirectory && !candidate.startsWith(`${distDirectory}${sep}`)) {
    sendJson(response, 403, { error: 'Forbidden.' })
    return
  }

  let filePath = candidate
  try {
    const info = await stat(filePath)
    if (info.isDirectory()) filePath = resolve(filePath, 'index.html')
    await access(filePath)
  } catch {
    // Client-side view switching uses one document; unknown paths load the app shell.
    filePath = resolve(distDirectory, 'index.html')
  }

  try {
    const info = await stat(filePath)
    response.writeHead(200, {
      'Content-Type': contentTypes[extname(filePath)] || 'application/octet-stream',
      'Content-Length': info.size,
      'X-Content-Type-Options': 'nosniff',
    })
    if (request.method === 'HEAD') {
      response.end()
      return
    }
    createReadStream(filePath).pipe(response)
  } catch {
    sendJson(response, 404, { error: 'Built app not found. Run npm run build first.' })
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://adaptivelearn.local')
  try {
    if (url.pathname === '/api/health' && request.method === 'GET') {
      sendJson(response, 200, {
        ok: true,
        aiConfigured: provider.isConfigured,
        provider: provider.name,
      })
      return
    }

    if (url.pathname === '/api/quiz') {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'Use POST to create a lesson quiz.' })
        return
      }
      if (!provider.isConfigured) {
        sendJson(response, 503, {
          error: 'AI_API_KEY is not configured. Copy .env.example to .env, add your key, then restart the app.',
        })
        return
      }

      const input = await readJsonBody(request)
      const quiz = await quizService.generate(input)
      sendJson(response, 200, { quiz })
      return
    }

    if (url.pathname === '/api/adapt') {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'Use POST to adapt a lesson.' })
        return
      }
      if (!provider.isConfigured) {
        sendJson(response, 503, {
          error: 'AI_API_KEY is not configured. Copy .env.example to .env, add your key, then restart the app.',
        })
        return
      }

      const input = await readJsonBody(request)
      const adaptations = await adaptationService.adapt(input)
      sendJson(response, 200, { adaptations })
      return
    }

    if (url.pathname.startsWith('/api/')) {
      sendJson(response, 404, { error: 'API route not found.' })
      return
    }

    if (serveStatic) {
      await serveBuiltApp(request, response, url.pathname)
      return
    }
    sendJson(response, 404, { error: 'Not found.' })
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500
    const message = statusCode === 500
      ? 'The AI service could not complete this request. Please try again.'
      : error.message
    sendJson(response, statusCode, { error: message })
  }
})

server.requestTimeout = 120_000
server.headersTimeout = 30_000
server.listen(port, '0.0.0.0', () => {
  const mode = serveStatic ? 'production app + API' : 'API'
  console.log(`${mode} listening on 0.0.0.0:${port} (provider: ${provider.name})`)
})
