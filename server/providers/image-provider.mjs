export const IMAGE_PROVIDERS = ['disabled', 'local-openai-compatible', 'openai-compatible']
export const MAX_IMAGE_PROMPT_CHARS = 1_000
export const MAX_IMAGE_BYTES = 4_000_000
const MAX_IMAGE_BASE64_CHARS = 6_000_000

export class ImageProviderError extends Error {
  constructor(message, statusCode = 502) {
    super(message)
    this.name = 'ImageProviderError'
    this.statusCode = statusCode
  }
}

function readEnv(env, name) {
  return String(env?.[name] ?? '').trim()
}

function requiredImageVars(providerName) {
  if (providerName === 'local-openai-compatible') return ['IMAGE_BASE_URL', 'IMAGE_MODEL']
  if (providerName === 'openai-compatible') return ['IMAGE_BASE_URL', 'IMAGE_MODEL', 'IMAGE_API_KEY']
  return []
}

/**
 * Report image configuration using variable names only — never values.
 * Local self-hosted servers often need no key; hosted endpoints require one.
 */
export function getImageStatus(env = process.env) {
  const providerName = readEnv(env, 'IMAGE_PROVIDER') || 'disabled'
  if (!IMAGE_PROVIDERS.includes(providerName)) {
    return { configured: false, provider: providerName, missing: [] }
  }
  if (providerName === 'disabled') {
    return { configured: false, provider: providerName, missing: [] }
  }
  const missing = requiredImageVars(providerName).filter((name) => !readEnv(env, name))
  return { configured: missing.length === 0, provider: providerName, missing }
}

function detectImageMimeType(bytes) {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return 'image/png'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  return null
}

function decodeBase64Image(base64) {
  if (typeof base64 !== 'string' || !base64.trim() || base64.length > MAX_IMAGE_BASE64_CHARS) {
    throw new ImageProviderError('The image service returned an invalid image response.', 502)
  }
  let bytes
  try {
    bytes = Buffer.from(base64.trim(), 'base64')
  } catch {
    throw new ImageProviderError('The image service returned an invalid image response.', 502)
  }
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    throw new ImageProviderError(
      `The generated image is too large (maximum ${(MAX_IMAGE_BYTES / 1_000_000).toFixed(0)} MB).`,
      502,
    )
  }
  const mimeType = detectImageMimeType(bytes)
  if (!mimeType) {
    throw new ImageProviderError('The image service did not return a PNG, JPEG, or WebP image.', 502)
  }
  return { bytes, mimeType }
}

/**
 * Server-side image adapter. Both non-disabled providers speak the
 * OpenAI Images API shape (`POST {baseUrl}/images/generations` with
 * `response_format: b64_json`), so self-hosted servers such as LocalAI and
 * hosted OpenAI-compatible endpoints share one request path. Nothing here
 * assumes the Chat Completions text endpoint can generate images.
 */
export function createImageProvider({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const providerName = readEnv(env, 'IMAGE_PROVIDER') || 'disabled'
  if (!IMAGE_PROVIDERS.includes(providerName)) {
    throw new Error(
      `Unsupported IMAGE_PROVIDER "${providerName}". Use one of: ${IMAGE_PROVIDERS.join(', ')}.`,
    )
  }

  const baseUrl = readEnv(env, 'IMAGE_BASE_URL').replace(/\/+$/, '').replace(/\/images\/generations$/, '')
  const model = readEnv(env, 'IMAGE_MODEL')
  const apiKey = readEnv(env, 'IMAGE_API_KEY')

  const status = getImageStatus(env)

  return {
    name: providerName,
    isConfigured: status.configured,
    getStatus: () => getImageStatus(env),

    async generate({ prompt }) {
      const current = getImageStatus(env)
      if (!current.configured) {
        if (current.provider === 'disabled') {
          throw new ImageProviderError(
            'Illustration generation is not configured. Set IMAGE_PROVIDER and the matching IMAGE_BASE_URL, IMAGE_MODEL, and IMAGE_API_KEY values server-side.',
            503,
          )
        }
        throw new ImageProviderError(
          `Illustration generation is missing configuration: ${current.missing.join(', ')}.`,
          503,
        )
      }
      if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > MAX_IMAGE_PROMPT_CHARS) {
        throw new ImageProviderError('The illustration prompt is invalid or too long.', 400)
      }

      let response
      try {
        const headers = { 'Content-Type': 'application/json' }
        if (apiKey) headers.Authorization = `Bearer ${apiKey}`
        response = await fetchImpl(`${baseUrl}/images/generations`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model,
            prompt: prompt.trim(),
            n: 1,
            size: '1024x1024',
            response_format: 'b64_json',
          }),
          signal: AbortSignal.timeout(180_000),
        })
      } catch (cause) {
        if (cause?.name === 'TimeoutError' || cause?.name === 'AbortError') {
          throw new ImageProviderError('The image request took too long. Please try again.', 504)
        }
        throw new ImageProviderError('The image service could not be reached. Please try again.', 502)
      }

      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new ImageProviderError(
            'The image service rejected the configured key. Check IMAGE_API_KEY in your .env file.',
            502,
          )
        }
        if (response.status === 429) {
          throw new ImageProviderError('The image service is busy or rate-limited. Please try again shortly.', 429)
        }
        throw new ImageProviderError(`The image service returned an error (${response.status}).`, 502)
      }

      const base64 = payload?.data?.[0]?.b64_json
      const { mimeType } = decodeBase64Image(base64)
      // Images are returned to the active session only; the server stores nothing.
      return { mimeType, base64: base64.trim() }
    },
  }
}
