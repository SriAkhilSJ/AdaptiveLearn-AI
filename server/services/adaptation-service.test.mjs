import test from 'node:test'
import assert from 'node:assert/strict'
import { createAdaptationService } from './adaptation-service.mjs'

const output = {
  standardExplanation: 'A clear standard explanation.',
  easyToReadExplanation: 'A short and simple explanation.',
  stepByStepExplanation: ['First, begin.', 'Next, continue.'],
  visualExplanation: {
    title: 'Water cycle',
    layout: 'flow',
    items: [
      { label: 'Evaporation', details: ['Water warms and rises'] },
      { label: 'Clouds', details: ['Water vapor cools'] },
      { label: 'Rain', details: ['Water falls back to Earth'] },
    ],
  },
  audioReadyExplanation: 'Let us explain this aloud.',
  personalizedLesson: 'A lesson shaped around the learner preferences.',
}

const lesson = {
  lesson: { title: 'Water cycle.pdf', text: 'Water evaporates, forms clouds, then falls as rain.' },
  profile: { supports: ['easy-text', 'visual', 'repetition'], preference: 'visual' },
}

test('builds all adaptation formats and includes saved preferences in the provider request', async () => {
  let request
  const service = createAdaptationService({
    generate: async (value) => {
      request = value
      return JSON.stringify(output)
    },
  })

  const result = await service.adapt(lesson)
  assert.deepEqual(result, output)
  const prompt = request.messages.map((message) => message.content).join('\n')
  assert.match(prompt, /Visual \(pictures and diagrams\)/)
  assert.match(prompt, /Easy-to-read text/)
  assert.match(prompt, /More repetition/)
  assert.match(prompt, /never claim that audio has been recorded/i)
  assert.match(prompt, /finish every section cleanly/i)
  assert.match(prompt, /sourceLessonText/)
})

test('converts legacy text visual explanations into compact diagram cards', async () => {
  const legacyVisual = [
    'Evolution of AI Operations (a stack, oldest at the bottom):',
    '[1] CLOUD COMPUTING & DEVOPS',
    'Industry problems and the tools used to solve them.',
    '[2] MLOPS & MODEL DEPLOYMENT',
    'Packaging and serving machine learning models.',
    '[3] AGENTOPS & ORCHESTRATION',
    'Agents plan tasks and use tools.',
  ].join('\n')
  const service = createAdaptationService({
    generate: async () => JSON.stringify({ ...output, visualExplanation: legacyVisual }),
  })

  const result = await service.adapt(lesson)
  assert.equal(result.visualExplanation.title, 'Evolution of AI Operations (a stack, oldest at the bottom)')
  assert.equal(result.visualExplanation.layout, 'stack')
  assert.deepEqual(result.visualExplanation.items.map((item) => item.label), [
    'CLOUD COMPUTING & DEVOPS',
    'MLOPS & MODEL DEPLOYMENT',
    'AGENTOPS & ORCHESTRATION',
  ])
  assert.deepEqual(result.visualExplanation.items[0].details, [
    'Industry problems and the tools used to solve them.',
  ])
})

test('normalizes a step-by-step string into a list', async () => {
  const service = createAdaptationService({
    generate: async () => JSON.stringify({ ...output, stepByStepExplanation: '1. First\n2. Then' }),
  })
  const result = await service.adapt(lesson)
  assert.deepEqual(result.stepByStepExplanation, ['First', 'Then'])
})

test('rejects an empty lesson before calling the provider', async () => {
  let called = false
  const service = createAdaptationService({
    generate: async () => {
      called = true
      return JSON.stringify(output)
    },
  })
  await assert.rejects(
    service.adapt({ lesson: { title: 'Blank.pdf', text: '  ' }, profile: {} }),
    /no extracted text/i,
  )
  assert.equal(called, false)
})

test('rejects lessons beyond the request limit before calling the provider', async () => {
  const service = createAdaptationService({ generate: async () => JSON.stringify(output) })
  await assert.rejects(
    service.adapt({ lesson: { title: 'Long.pdf', text: 'x'.repeat(60_001) }, profile: {} }),
    /too long/i,
  )
})

test('rejects incomplete model output instead of showing partial adaptations', async () => {
  const service = createAdaptationService({
    generate: async () => JSON.stringify({ standardExplanation: 'Only one field.' }),
  })
  await assert.rejects(service.adapt(lesson), /incomplete lesson/i)
})
