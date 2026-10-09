import test from 'node:test'
import assert from 'node:assert/strict'
import { createImageProvider, getImageStatus } from './image-provider.mjs'

// A 1x1 transparent PNG.
const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

function imageResponse(base64) {
  return new Response(
    JSON.stringify({ data: [{ b64_json: base64 }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

const localEnv = {
  IMAGE_PROVIDER: 'local-openai-compatible',
  IMAGE_BASE_URL: 'http://127.0.0.1:8080/v1/',
  IMAGE_MODEL: 'test-image-model',
  IMAGE_API_KEY: '',
}

test('sends an OpenAI Images request and validates the returned artwork', async () => {
  let captured
  const provider = createImageProvider({
    env: { ...localEnv, IMAGE_API_KEY: 'local-test-key' },
    fetchImpl: async (url, options) => {
      captured = { url, options }
      return imageResponse(tinyPngBase64)
    },
  })

  const result = await provider.generate({ prompt: 'A friendly leaf in sunlight.' })
  assert.equal(result.mimeType, 'image/png')
  assert.equal(result.base64, tinyPngBase64)
  assert.equal(captured.url, 'http://127.0.0.1:8080/v1/images/generations')
  assert.equal(captured.options.headers.Authorization, 'Bearer local-test-key')
  const body = JSON.parse(captured.options.body)
  assert.equal(body.model, 'test-image-model')
  assert.equal(body.prompt, 'A friendly leaf in sunlight.')
  assert.equal(body.n, 1)
  assert.equal(body.response_format, 'b64_json')
})

test('omits the auth header for local servers without a key', async () => {
  let captured
  const provider = createImageProvider({
    env: localEnv,
    fetchImpl: async (url, options) => {
      captured = { url, options }
      return imageResponse(tinyPngBase64)
    },
  })

  assert.equal(provider.isConfigured, true)
  await provider.generate({ prompt: 'A friendly leaf in sunlight.' })
  assert.ok(!('Authorization' in captured.options.headers))
})

test('reports configuration with variable names only, never values', async () => {
  const secret = 'super-secret-image-key-12345'
  const status = getImageStatus({
    IMAGE_PROVIDER: 'openai-compatible',
    IMAGE_BASE_URL: '',
    IMAGE_MODEL: 'some-model',
    IMAGE_API_KEY: secret,
  })
  assert.equal(status.configured, false)
  assert.deepEqual(status.missing, ['IMAGE_BASE_URL'])
  assert.ok(!JSON.stringify(status).includes(secret))
  assert.ok(!JSON.stringify(status).includes('some-model'))

  const missing = getImageStatus({
    IMAGE_PROVIDER: 'openai-compatible',
    IMAGE_BASE_URL: 'https://images.example.test/v1',
    IMAGE_MODEL: '',
    IMAGE_API_KEY: '',
  })
  assert.deepEqual(missing.missing, ['IMAGE_MODEL', 'IMAGE_API_KEY'])

  const disabled = getImageStatus({ IMAGE_PROVIDER: 'disabled' })
  assert.equal(disabled.configured, false)
})

test('refuses to generate while disabled without naming any secret value', async () => {
  let called = false
  const provider = createImageProvider({
    env: { IMAGE_PROVIDER: 'disabled', IMAGE_API_KEY: 'hidden-value' },
    fetchImpl: async () => {
      called = true
      return imageResponse(tinyPngBase64)
    },
  })
  await assert.rejects(provider.generate({ prompt: 'A leaf.' }), /not configured/)
  assert.equal(called, false)
})

test('lists missing variable names when required image settings are absent', async () => {
  let called = false
  const provider = createImageProvider({
    env: { IMAGE_PROVIDER: 'local-openai-compatible', IMAGE_BASE_URL: '', IMAGE_MODEL: '' },
    fetchImpl: async () => {
      called = true
      return imageResponse(tinyPngBase64)
    },
  })
  await assert.rejects(
    provider.generate({ prompt: 'A leaf.' }),
    /IMAGE_BASE_URL, IMAGE_MODEL/,
  )
  assert.equal(called, false)
})

test('rejects an unsupported image provider', () => {
  assert.throws(
    () => createImageProvider({ env: { IMAGE_PROVIDER: 'paid-magic-art' } }),
    /Unsupported IMAGE_PROVIDER/,
  )
})

test('rejects an overlong prompt before contacting the image service', async () => {
  let called = false
  const provider = createImageProvider({
    env: localEnv,
    fetchImpl: async () => {
      called = true
      return imageResponse(tinyPngBase64)
    },
  })
  await assert.rejects(provider.generate({ prompt: `x${'y'.repeat(2000)}` }), /too long/i)
  assert.equal(called, false)
})

test('rejects a non-image payload from the image service', async () => {
  const provider = createImageProvider({
    env: localEnv,
    fetchImpl: async () => imageResponse(Buffer.from('not an image at all').toString('base64')),
  })
  await assert.rejects(provider.generate({ prompt: 'A leaf.' }), /did not return a PNG, JPEG, or WebP/i)
})

test('rejects an image missing from the service response', async () => {
  const provider = createImageProvider({
    env: localEnv,
    fetchImpl: async () => new Response(JSON.stringify({ data: [] }), { status: 200 }),
  })
  await assert.rejects(provider.generate({ prompt: 'A leaf.' }), /invalid image response/i)
})

test('rejects oversized image responses', async () => {
  const oversized = Buffer.alloc(4_000_001, 7).toString('base64')
  const provider = createImageProvider({
    env: localEnv,
    fetchImpl: async () => imageResponse(oversized),
  })
  await assert.rejects(provider.generate({ prompt: 'A leaf.' }), /too large/i)
})

test('reports a rejected image key without exposing it', async () => {
  const provider = createImageProvider({
    env: { ...localEnv, IMAGE_API_KEY: 'wrong-key-value' },
    fetchImpl: async () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
  })
  try {
    await provider.generate({ prompt: 'A leaf.' })
    assert.fail('Expected the rejected key to throw.')
  } catch (cause) {
    assert.match(cause.message, /rejected the configured key/i)
    assert.ok(!cause.message.includes('wrong-key-value'))
  }
})
