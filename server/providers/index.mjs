import { createOpenAICompatibleProvider } from './openai-compatible.mjs'

/** Select an adapter via server-only environment configuration. */
export function createAIProvider(env = process.env) {
  const name = env.AI_PROVIDER || 'openai-compatible'
  if (name === 'openai-compatible') {
    return createOpenAICompatibleProvider({
      apiKey: env.AI_API_KEY,
      baseUrl: env.AI_BASE_URL || 'https://api.openai.com/v1',
      model: env.AI_MODEL || 'gpt-4o-mini',
    })
  }

  throw new Error(`Unsupported AI_PROVIDER "${name}". Add a provider adapter before selecting it.`)
}
