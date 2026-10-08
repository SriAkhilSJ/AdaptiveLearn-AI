export class ProviderError extends Error {
  constructor(message, statusCode = 502) {
    super(message)
    this.name = 'ProviderError'
    this.statusCode = statusCode
  }
}

/**
 * OpenAI Chat Completions-compatible adapter.
 * Implement the same `generate({ messages })` interface for another provider.
 */
export function createOpenAICompatibleProvider({
  apiKey,
  baseUrl = 'https://api.openai.com/v1',
  model = 'gpt-4o-mini',
  fetchImpl = globalThis.fetch,
}) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '').replace(/\/chat\/completions$/, '')
  const normalizedApiKey = typeof apiKey === 'string' ? apiKey.trim() : ''

  return {
    name: 'openai-compatible',
    isConfigured: Boolean(normalizedApiKey),

    async generate({ messages }) {
      if (!normalizedApiKey) {
        throw new ProviderError(
          'AI_API_KEY is not configured. Add it to your local .env file and restart the app.',
          503,
        )
      }

      let response
      try {
        response = await fetchImpl(`${normalizedBaseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${normalizedApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: 0.3,
            max_tokens: 6000,
            response_format: { type: 'json_object' },
          }),
          signal: AbortSignal.timeout(90_000),
        })
      } catch (cause) {
        if (cause?.name === 'TimeoutError' || cause?.name === 'AbortError') {
          throw new ProviderError('The AI request took too long. Please try again.', 504)
        }
        throw new ProviderError('The AI provider could not be reached. Please try again.', 502)
      }

      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new ProviderError(
            'The AI provider rejected the configured key. Check AI_API_KEY in your .env file.',
            502,
          )
        }
        if (response.status === 429) {
          throw new ProviderError('The AI provider is busy or rate-limited. Please try again shortly.', 429)
        }
        throw new ProviderError(`The AI provider returned an error (${response.status}).`, 502)
      }

      const content = payload?.choices?.[0]?.message?.content
      if (typeof content !== 'string' || !content.trim()) {
        throw new ProviderError('The AI provider returned an empty response. Please try again.', 502)
      }
      return content
    },
  }
}
