import test from 'node:test'
import assert from 'node:assert/strict'
import { createQuizService } from './quiz-service.mjs'

const quiz = {
  questions: [
    {
      question: 'What causes water to evaporate?',
      choices: ['Cooling', 'Heating', 'Freezing', 'Condensation'],
      correctIndex: 1,
      concept: 'Evaporation',
      explanation: 'The lesson says heat changes liquid water into vapor.',
    },
    {
      question: 'Where does water vapor collect?',
      choices: ['In clouds', 'In rocks', 'In roots', 'In soil only'],
      correctIndex: 0,
      concept: 'Cloud formation',
      explanation: 'Water vapor cools and forms clouds.',
    },
    {
      question: 'What is precipitation?',
      choices: ['Water rising', 'Clouds warming', 'Water falling from clouds', 'Water freezing underground'],
      correctIndex: 2,
      concept: 'Precipitation',
      explanation: 'Rain is water that falls from clouds.',
    },
    {
      question: 'What happens after water reaches the ground?',
      choices: ['It disappears', 'It collects in bodies of water', 'It becomes sunlight', 'It stops moving'],
      correctIndex: 1,
      concept: 'Collection',
      explanation: 'The lesson describes water collecting before the cycle repeats.',
    },
    {
      question: 'Which process begins the cycle?',
      choices: ['Collection', 'Precipitation', 'Condensation', 'Evaporation'],
      correctIndex: 3,
      concept: 'Water-cycle sequence',
      explanation: 'The sequence begins when heat causes evaporation.',
    },
  ],
}

const lesson = {
  lesson: {
    title: 'Water cycle.pdf',
    text: 'Heat causes water to evaporate. Water vapor cools and forms clouds. Rain falls, and water collects before the cycle repeats.',
  },
}

test('creates five validated questions from the uploaded lesson', async () => {
  let request
  const service = createQuizService({
    generate: async (value) => {
      request = value
      return JSON.stringify(quiz)
    },
  })

  const result = await service.generate(lesson)
  assert.deepEqual(result, quiz)
  assert.equal(result.questions.length, 5)
  assert.equal(result.questions.every((question) => question.choices.length === 4), true)
  const userMessage = JSON.parse(request.messages[1].content)
  assert.equal(userMessage.sourceLessonText, lesson.lesson.text)
  assert.match(request.messages[0].content, /exactly 5 distinct multiple-choice questions/i)
})

test('accepts a JSON-fenced provider response', async () => {
  const service = createQuizService({
    generate: async () => `\`\`\`json\n${JSON.stringify(quiz)}\n\`\`\``,
  })
  const result = await service.generate(lesson)
  assert.equal(result.questions.length, 5)
})

test('rejects a blank lesson before calling the provider', async () => {
  let called = false
  const service = createQuizService({
    generate: async () => {
      called = true
      return JSON.stringify(quiz)
    },
  })

  await assert.rejects(
    service.generate({ lesson: { title: 'Blank.pdf', text: ' ' } }),
    /no extracted text/i,
  )
  assert.equal(called, false)
})

test('rejects a lesson over the quiz size limit before calling the provider', async () => {
  const service = createQuizService({ generate: async () => JSON.stringify(quiz) })
  await assert.rejects(
    service.generate({ lesson: { title: 'Long.pdf', text: 'x'.repeat(60_001) } }),
    /too long to quiz/i,
  )
})

test('rejects model output with a question count other than five', async () => {
  const service = createQuizService({
    generate: async () => JSON.stringify({ questions: quiz.questions.slice(0, 4) }),
  })
  await assert.rejects(service.generate(lesson), /incomplete quiz/i)
})

test('rejects questions that do not have exactly four distinct choices', async () => {
  const malformedQuiz = structuredClone(quiz)
  malformedQuiz.questions[0].choices[3] = malformedQuiz.questions[0].choices[0]
  const service = createQuizService({ generate: async () => JSON.stringify(malformedQuiz) })
  await assert.rejects(service.generate(lesson), /incomplete quiz/i)
})
