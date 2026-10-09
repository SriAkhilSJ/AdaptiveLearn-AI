import test from 'node:test'
import assert from 'node:assert/strict'
import { createQuizFeedbackService } from './quiz-feedback-service.mjs'

const feedback = {
  simpleExplanation: 'Plants use sunlight to make food from water and carbon dioxide.',
  visualExplanation: {
    title: 'How a plant makes food',
    summary: 'Leaves use sunlight to turn water and carbon dioxide into sugar.',
    layout: 'flow',
    items: [
      { label: 'Sunlight', details: ['Provides energy'] },
      { label: 'Plant leaves', details: ['Use water and carbon dioxide'] },
      { label: 'Sugar', details: ['Food made by the plant'] },
    ],
  },
  example: 'A plant by a sunny window uses light to help make the food it needs.',
}

const input = {
  lesson: {
    title: 'Photosynthesis.pdf',
    text: 'Plants use light energy to change water and carbon dioxide into sugar and oxygen.',
  },
  question: {
    question: 'What does a plant make during photosynthesis?',
    choices: ['Sugar', 'Sand', 'Metal', 'Salt'],
    concept: 'Photosynthesis',
  },
  incorrectAnswer: 'Sand',
  explanationStyle: 'Explain it like a One Piece anime adventure',
}

test('generates simple, visual, example-based feedback for the missed concept', async () => {
  let request
  const service = createQuizFeedbackService({
    generate: async (value) => {
      request = value
      return JSON.stringify(feedback)
    },
  })

  const result = await service.generate(input)
  assert.deepEqual(result, { concept: 'Photosynthesis', ...feedback })
  const userMessage = JSON.parse(request.messages[1].content)
  assert.equal(userMessage.weakConcept, 'Photosynthesis')
  assert.equal(userMessage.studentSelectedAnswer, 'Sand')
  assert.equal(userMessage.sourceLessonText, input.lesson.text)
  assert.equal(userMessage.learnerRequestedExplanationStyle, input.explanationStyle)
  assert.equal('correctIndex' in userMessage, false)
  assert.match(request.messages[0].content, /Do not state the correct answer/i)
  assert.match(request.messages[0].content, /presentation guidance only/i)
  assert.match(request.messages[0].content, /the app renders real arrows/i)
})

test('limits the learner explanation style in quiz-remediation prompts', async () => {
  let request
  const service = createQuizFeedbackService({
    generate: async (value) => {
      request = value
      return JSON.stringify(feedback)
    },
  })

  await service.generate({ ...input, explanationStyle: 'x'.repeat(300) })
  const userMessage = JSON.parse(request.messages[1].content)
  assert.equal(userMessage.learnerRequestedExplanationStyle.length, 160)
})

test('normalizes cycle visuals in quiz remediation for quick scanning', async () => {
  const service = createQuizFeedbackService({
    generate: async () => JSON.stringify({
      ...feedback,
      visualExplanation: {
        ...feedback.visualExplanation,
        title: 'How feedback loops work',
        summary: 'An output changes the next input, so the process repeats.',
        layout: 'cycle',
      },
    }),
  })

  const result = await service.generate(input)
  assert.equal(result.visualExplanation.layout, 'cycle')
  assert.match(result.visualExplanation.summary, /output changes the next input/i)
})

test('rejects an answer that is not one of the question choices before calling the provider', async () => {
  let called = false
  const service = createQuizFeedbackService({
    generate: async () => {
      called = true
      return JSON.stringify(feedback)
    },
  })

  await assert.rejects(
    service.generate({ ...input, incorrectAnswer: 'Not an option' }),
    /select an answer/i,
  )
  assert.equal(called, false)
})

test('rejects feedback without a visual diagram', async () => {
  const service = createQuizFeedbackService({
    generate: async () => JSON.stringify({ ...feedback, visualExplanation: { title: 'Map', items: [] } }),
  })
  await assert.rejects(service.generate(input), /could not create complete feedback/i)
})
