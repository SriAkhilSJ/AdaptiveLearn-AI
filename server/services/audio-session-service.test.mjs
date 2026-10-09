import assert from 'node:assert/strict'
import test from 'node:test'
import { TrackSource } from 'livekit-server-sdk'
import { createAudioSessionService } from './audio-session-service.mjs'

const env = {
  LIVEKIT_URL: 'wss://lesson-room.example.test',
  LIVEKIT_API_KEY: 'livekit-public-key',
  LIVEKIT_API_SECRET: 'livekit-private-secret',
  DEEPGRAM_API_KEY: 'speech-private-key',
  AI_API_KEY: 'model-private-key',
  AI_BASE_URL: 'https://model.example.test/v1',
  AI_MODEL: 'lesson-model',
}

function createService(overrides = {}) {
  const calls = { accessToken: null, grant: null, dispatch: null, livekitOptions: null }
  const dependencies = {
    env: { ...env },
    aiConfigured: true,
    createUUID: () => 'test-session-id',
    createAccessToken: (key, secret, options) => {
      calls.accessToken = { key, secret, options }
      return {
        addGrant(grant) {
          calls.grant = grant
        },
        async toJwt() {
          return 'short-lived-client-token'
        },
      }
    },
    createLiveKitApi(options) {
      calls.livekitOptions = options
      return {
        agentDispatch: {
          async createDispatch(room, agentName, options) {
            calls.dispatch = { room, agentName, options }
            return { id: 'dispatch-id' }
          },
        },
      }
    },
    ...overrides,
  }
  return { service: createAudioSessionService(dependencies), calls }
}

const sampleRequest = {
  lesson: { title: 'How plants make food', text: 'Plants use light, water, and carbon dioxide.' },
  adaptations: {
    personalizedLesson: 'Let us work through the idea together.',
    easyToReadExplanation: 'Plants use light to make food.',
    stepByStepExplanation: ['The plant takes in light.', 'The plant uses it to make food.'],
    audioReadyExplanation: 'This prepared passage is not sent as a tutor script.',
  },
  profile: {
    preference: 'audio',
    supports: ['steps', 'audio', 'not-a-support'],
    explanationStyle: 'Use a garden analogy.',
  },
}

test('audio status reports missing configuration names without exposing values', () => {
  const { service } = createService({
    env: { LIVEKIT_API_KEY: 'do-not-return-this' },
    aiConfigured: false,
  })

  const status = service.getStatus()
  assert.equal(status.configured, false)
  assert.deepEqual(status.missing, [
    'AI_API_KEY',
    'LIVEKIT_URL',
    'LIVEKIT_API_SECRET',
    'DEEPGRAM_API_KEY',
  ])
  assert.equal(JSON.stringify(status).includes('do-not-return-this'), false)
})

test('creates a microphone-only token and dispatches a private lesson-grounded tutor', async () => {
  const { service, calls } = createService()

  const session = await service.createSession(sampleRequest)

  assert.deepEqual(session, {
    url: env.LIVEKIT_URL,
    token: 'short-lived-client-token',
    roomName: 'adaptivelearn-test-session-id',
  })
  assert.deepEqual(calls.accessToken, {
    key: env.LIVEKIT_API_KEY,
    secret: env.LIVEKIT_API_SECRET,
    options: {
      identity: 'learner-test-session-id',
      name: 'Learner',
      ttl: '10m',
    },
  })
  assert.deepEqual(calls.grant, {
    roomJoin: true,
    room: 'adaptivelearn-test-session-id',
    canSubscribe: true,
    canPublishSources: [TrackSource.MICROPHONE],
    canPublishData: false,
  })
  assert.deepEqual(calls.dispatch, {
    room: 'adaptivelearn-test-session-id',
    agentName: 'adaptivelearn-audio-tutor',
    options: {
      metadata: JSON.stringify({
        lesson: sampleRequest.lesson,
        adaptations: {
          personalizedLesson: sampleRequest.adaptations.personalizedLesson,
          easyToReadExplanation: sampleRequest.adaptations.easyToReadExplanation,
          stepByStepExplanation: sampleRequest.adaptations.stepByStepExplanation,
        },
        learnerPreferences: {
          preference: 'audio',
          supports: ['steps', 'audio'],
          explanationStyle: 'Use a garden analogy.',
        },
      }),
    },
  })
  assert.equal(calls.livekitOptions.host, env.LIVEKIT_URL)
  assert.equal(calls.livekitOptions.apiKey, env.LIVEKIT_API_KEY)
  assert.equal(calls.livekitOptions.secret, env.LIVEKIT_API_SECRET)
  assert.equal(calls.livekitOptions.failover, false)
  assert.equal(JSON.stringify(session).includes(env.LIVEKIT_API_SECRET), false)
})

test('refuses to dispatch when the lesson is missing or exceeds the supported size', async () => {
  const { service, calls } = createService()

  await assert.rejects(
    service.createSession({ lesson: { title: 'Empty', text: '  ' } }),
    { statusCode: 400, message: 'The uploaded lesson has no extracted text for the tutor to use.' },
  )
  await assert.rejects(
    service.createSession({ lesson: { title: 'Too long', text: 'x'.repeat(60_001) } }),
    { statusCode: 413 },
  )
  assert.equal(calls.dispatch, null)
})

test('returns a safe setup error rather than attempting a LiveKit call when keys are absent', async () => {
  const { service, calls } = createService({
    env: { AI_API_KEY: '', LIVEKIT_URL: '', LIVEKIT_API_KEY: '', LIVEKIT_API_SECRET: '', DEEPGRAM_API_KEY: '' },
    aiConfigured: false,
  })

  await assert.rejects(
    service.createSession(sampleRequest),
    {
      statusCode: 503,
      message: 'Audio tutoring is not configured yet. Set these server-side values in .env: AI_API_KEY, LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, DEEPGRAM_API_KEY.',
    },
  )
  assert.equal(calls.dispatch, null)
})

test('normalizes unsupported profile values and enforces the LiveKit job metadata size limit', async () => {
  const { service, calls } = createService()
  const invalidPreference = {
    ...sampleRequest,
    profile: { preference: 'diagnosis', supports: ['invented'], explanationStyle: '   ' },
  }
  await service.createSession(invalidPreference)
  const dispatchedContext = JSON.parse(calls.dispatch.options.metadata)
  assert.deepEqual(dispatchedContext.learnerPreferences, {
    preference: null,
    supports: [],
    explanationStyle: '',
  })

  const controlCharacter = String.fromCharCode(1)
  await assert.rejects(
    service.createSession({
      lesson: { title: 'Large', text: controlCharacter.repeat(60_000) },
      adaptations: {
        personalizedLesson: controlCharacter.repeat(40_000),
        easyToReadExplanation: controlCharacter.repeat(40_000),
        stepByStepExplanation: Array.from({ length: 20 }, () => controlCharacter.repeat(1_000)),
      },
    }),
    { statusCode: 413 },
  )
})
