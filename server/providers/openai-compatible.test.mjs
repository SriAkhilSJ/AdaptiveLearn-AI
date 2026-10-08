import test from 'node:test'
import assert from 'node:assert/strict'
import { createOpenAICompatibleProvider } from './openai-compatible.mjs'

const messages = [
  { role: 'system', content: 'Return JSON.' },
  { role: 'user', content: 'Adapt this lesson.' },
]

test('uses server configuration in the OpenAI-compatible request and returns text', async () => {
  let captured
  const provider = createOpenAICompatibleProvider({
    apiKey: 'test-key',
    baseUrl: 'https://ai.example.test/v1/',
    model: 'test-model',
    fetchImpl: async (url, options) => {
      captured = { url, options }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    },
  })

  const text = await provider.generate({ messages })
  assert.equal(text, '{"ok":true}')
  assert.equal(captured.url, 'https://ai.example.test/v1/chat/completions')
  assert.equal(captured.options.headers.Authorization, 'Bearer test-key')
  const body = JSON.parse(captured.options.body)
  assert.equal(body.model, 'test-model')
  assert.deepEqual(body.messages, messages)
  assert.deepEqual(body.response_format, { type: 'json_object' })
})

test('does not make a provider request if the server key is missing', async () => {
  let called = false
  const provider = createOpenAICompatibleProvider({
    apiKey: '',
    fetchImpl: async () => {
      called = true
      return new Response('{}')
    },
  })
  await assert.rejects(provider.generate({ messages }), /AI_API_KEY is not configured/)
  assert.equal(called, false)
})
