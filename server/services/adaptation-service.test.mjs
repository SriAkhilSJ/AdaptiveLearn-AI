import test from 'node:test'
import assert from 'node:assert/strict'
import { createAdaptationService } from './adaptation-service.mjs'

const output = {
  standardExplanation: 'A clear standard explanation.',
  easyToReadExplanation: 'A short and simple explanation.',
  stepByStepExplanation: ['First, begin.', 'Next, continue.'],
  visualExplanation: {
    title: 'Water cycle',
    summary: 'Sunlight moves water through evaporation, clouds, and rain.',
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
  profile: {
    supports: ['easy-text', 'visual', 'repetition'],
    preference: 'visual',
    explanationStyle: 'Explain it like a One Piece anime adventure',
  },
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
  assert.match(prompt, /learnerRequestedExplanationStyle/)
  assert.match(prompt, /Explain it like a One Piece anime adventure/)
  assert.match(prompt, /presentation guidance only/i)
  assert.match(prompt, /never claim that audio has been recorded/i)
  assert.match(prompt, /finish every section cleanly/i)
  assert.match(prompt, /whole-lesson overview/i)
  assert.match(prompt, /actual arrows, a loop, layers, or side-by-side groups/i)
  assert.match(prompt, /short spoken overview/i)
  assert.match(prompt, /sourceLessonText/)
})

test('limits the learner explanation-style field before including it in the prompt', async () => {
  let request
  const service = createAdaptationService({
    generate: async (value) => {
      request = value
      return JSON.stringify(output)
    },
  })

  await service.adapt({
    ...lesson,
    profile: { ...lesson.profile, explanationStyle: 'x'.repeat(300) },
  })

  const userMessage = JSON.parse(request.messages[1].content)
  assert.equal(userMessage.learnerRequestedExplanationStyle.length, 160)
})

test('converts legacy text visual explanations into compact layered diagrams', async () => {
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

test('normalizes a concise at-a-glance cycle map and trims verbose node text', async () => {
  const service = createAdaptationService({
    generate: async () => JSON.stringify({
      ...output,
      visualExplanation: {
        title: 'The scientific method',
        summary: 'Scientists test ideas, learn from evidence, and refine the next question. '.repeat(2),
        layout: 'cycle',
        items: [
          { label: 'Ask a focused question about the world', details: ['A question makes the topic testable', 'Extra detail should be removed'] },
          { label: 'Make a prediction', details: ['Use what is already known'] },
          { label: 'Test and observe', details: ['Collect evidence carefully'] },
          { label: 'Review the evidence', details: ['Use the result to improve the next question'] },
          { label: 'Repeat with a sharper question', details: ['The process continues'] },
          { label: 'Out-of-scope extra node', details: [] },
        ],
      },
    }),
  })

  const { visualExplanation } = await service.adapt(lesson)
  assert.equal(visualExplanation.layout, 'cycle')
  assert.equal(visualExplanation.items.length, 5)
  assert.ok(visualExplanation.summary.length <= 120)
  assert.ok(visualExplanation.items.every((item) => item.label.length <= 32))
  assert.ok(visualExplanation.items.every((item) => item.details.length <= 1))
  assert.ok(visualExplanation.items.every((item) => item.details.every((detail) => detail.length <= 52)))
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

test('rejects a visual summary with too few concepts to represent a whole lesson', async () => {
  const service = createAdaptationService({
    generate: async () => JSON.stringify({
      ...output,
      visualExplanation: {
        title: 'Too small to summarize',
        summary: 'A single fact is not a whole-lesson map.',
        layout: 'flow',
        items: [{ label: 'One idea', details: [] }, { label: 'Another idea', details: [] }],
      },
    }),
  })

  await assert.rejects(service.adapt(lesson), /incomplete lesson/i)
})

test('rejects incomplete model output instead of showing partial adaptations', async () => {
  const service = createAdaptationService({
    generate: async () => JSON.stringify({ standardExplanation: 'Only one field.' }),
  })
  await assert.rejects(service.adapt(lesson), /incomplete lesson/i)
})
