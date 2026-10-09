import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPanelImagePrompt, createComicImageService } from './comic-image-service.mjs'

const panel = { id: 'panel-2', scene: 'A large friendly leaf with water drops and soft drifting air.' }

test('builds a bounded, text-free illustration prompt from one panel', () => {
  const prompt = buildPanelImagePrompt({ title: 'How plants make food', scene: panel.scene })
  assert.ok(prompt.length <= 1000)
  assert.match(prompt, /original characters/i)
  assert.match(prompt, /no words, letters, numbers/i)
  assert.match(prompt, /do not depict copyrighted characters/i)
  assert.ok(prompt.includes(panel.scene))
  assert.ok(prompt.includes('How plants make food'))
})

test('generates one panel illustration and returns it with its panel id', async () => {
  let captured
  const service = createComicImageService({
    generate: async (value) => {
      captured = value
      return { mimeType: 'image/png', base64: 'aGVsbG8=' }
    },
  })

  const result = await service.generatePanelImage({ panel, title: 'How plants make food' })
  assert.deepEqual(result, { panelId: 'panel-2', mimeType: 'image/png', base64: 'aGVsbG8=' })
  assert.ok(captured.prompt.includes(panel.scene))
})

test('rejects an invalid panel before calling the image provider', async () => {
  let called = false
  const service = createComicImageService({
    generate: async () => {
      called = true
      return { mimeType: 'image/png', base64: 'aGVsbG8=' }
    },
  })

  await assert.rejects(service.generatePanelImage({}), /panel is required/i)
  await assert.rejects(
    service.generatePanelImage({ panel: { id: 'panel-99', scene: panel.scene } }),
    /panel id is invalid/i,
  )
  await assert.rejects(
    service.generatePanelImage({ panel: { id: 'panel-1', scene: '   ' } }),
    /no scene/i,
  )
  await assert.rejects(
    service.generatePanelImage({ panel: { id: 'panel-1', scene: 'x'.repeat(1001) } }),
    /too long/i,
  )
  assert.equal(called, false)
})

test('surfaces provider configuration errors without secret values', async () => {
  const providerError = new Error('Illustration generation is missing configuration: IMAGE_MODEL.')
  providerError.statusCode = 503
  const service = createComicImageService({
    generate: async () => {
      throw providerError
    },
  })

  await assert.rejects(
    service.generatePanelImage({ panel }),
    /missing configuration: IMAGE_MODEL/,
  )
})
