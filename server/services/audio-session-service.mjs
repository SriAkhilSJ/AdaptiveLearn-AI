import { randomUUID } from 'node:crypto'
import { AccessToken, LiveKitAPI, TrackSource } from 'livekit-server-sdk'

export const MAX_AUDIO_LESSON_CHARS = 60_000
export const MAX_AUDIO_CONTEXT_BYTES = 480 * 1024
export const DEFAULT_AUDIO_AGENT_NAME = 'adaptivelearn-audio-tutor'

const MAX_TITLE_CHARS = 200
const MAX_ADAPTATION_CHARS = 40_000
const MAX_EXPLANATION_STYLE_CHARS = 160
const MAX_STEP_CHARS = 1_000
const MAX_STEPS = 20
const VALID_PREFERENCES = new Set(['text', 'audio', 'visual', 'mixed'])
const VALID_SUPPORTS = new Set([
  'easy-text',
  'audio',
  'visual',
  'steps',
  'large-text',
  'repetition',
])

export class AudioSessionError extends Error {
  constructor(message, statusCode = 400) {
    super(message)
    this.name = 'AudioSessionError'
    this.statusCode = statusCode
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cleanOptionalText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function normalizeAudioContext(input) {
  if (!isRecord(input) || !isRecord(input.lesson)) {
    throw new AudioSessionError('A lesson is required to start an audio tutoring session.')
  }

  const title = cleanOptionalText(input.lesson.title, MAX_TITLE_CHARS) || 'Uploaded lesson'
  const text = typeof input.lesson.text === 'string' ? input.lesson.text.trim() : ''
  if (!text) {
    throw new AudioSessionError('The uploaded lesson has no extracted text for the tutor to use.')
  }
  if (text.length > MAX_AUDIO_LESSON_CHARS) {
    throw new AudioSessionError(
      `This lesson is longer than audio tutoring supports right now (maximum ${MAX_AUDIO_LESSON_CHARS.toLocaleString()} characters).`,
      413,
    )
  }

  const adaptations = isRecord(input.adaptations) ? input.adaptations : {}
  const steps = Array.isArray(adaptations.stepByStepExplanation)
    ? adaptations.stepByStepExplanation
        .filter((step) => typeof step === 'string' && step.trim())
        .slice(0, MAX_STEPS)
        .map((step) => step.trim().slice(0, MAX_STEP_CHARS))
    : []

  const suppliedProfile = isRecord(input.profile) ? input.profile : {}
  const supports = Array.isArray(suppliedProfile.supports)
    ? [...new Set(suppliedProfile.supports.filter((support) => VALID_SUPPORTS.has(support)))]
    : []
  const preference = VALID_PREFERENCES.has(suppliedProfile.preference)
    ? suppliedProfile.preference
    : null

  return {
    lesson: { title, text },
    adaptations: {
      personalizedLesson: cleanOptionalText(adaptations.personalizedLesson, MAX_ADAPTATION_CHARS),
      easyToReadExplanation: cleanOptionalText(adaptations.easyToReadExplanation, MAX_ADAPTATION_CHARS),
      stepByStepExplanation: steps,
    },
    learnerPreferences: {
      preference,
      supports,
      explanationStyle: cleanOptionalText(
        suppliedProfile.explanationStyle,
        MAX_EXPLANATION_STYLE_CHARS,
      ).replace(/\s+/g, ' '),
    },
  }
}

/**
 * Creates short-lived, microphone-only LiveKit credentials and explicitly dispatches
 * one lesson-grounded agent into the private room. All provider secrets stay server-side.
 */
export function createAudioSessionService({
  env = process.env,
  aiConfigured = Boolean(String(env.AI_API_KEY ?? '').trim()),
  createLiveKitApi = ({
    host = env.LIVEKIT_URL,
    apiKey = env.LIVEKIT_API_KEY,
    secret = env.LIVEKIT_API_SECRET,
    failover = false,
  } = {}) => new LiveKitAPI({ host, apiKey, secret, failover }),
  createAccessToken = (...args) => new AccessToken(...args),
  createUUID = randomUUID,
} = {}) {
  const isAIConfigured = () => typeof aiConfigured === 'function' ? aiConfigured() : aiConfigured

  function getStatus() {
    const missing = []
    if (!isAIConfigured()) missing.push('AI_API_KEY')
    for (const name of ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'DEEPGRAM_API_KEY']) {
      if (!String(env[name] ?? '').trim()) missing.push(name)
    }
    return { configured: missing.length === 0, missing }
  }

  async function createSession(input) {
    const status = getStatus()
    if (!status.configured) {
      throw new AudioSessionError(
        `Audio tutoring is not configured yet. Set these server-side values in .env: ${status.missing.join(', ')}.`,
        503,
      )
    }

    const context = normalizeAudioContext(input)
    const metadata = JSON.stringify(context)
    if (Buffer.byteLength(metadata, 'utf8') > MAX_AUDIO_CONTEXT_BYTES) {
      throw new AudioSessionError(
        'This lesson and its adaptations are too large to start an audio session. Try a shorter lesson.',
        413,
      )
    }

    const sessionId = createUUID()
    const roomName = `adaptivelearn-${sessionId}`
    const identity = `learner-${sessionId}`
    const token = createAccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
      identity,
      name: 'Learner',
      ttl: '10m',
    })
    token.addGrant({
      roomJoin: true,
      room: roomName,
      canSubscribe: true,
      canPublishSources: [TrackSource.MICROPHONE],
      canPublishData: false,
    })
    const jwt = await token.toJwt()

    try {
      const livekit = createLiveKitApi({
        host: env.LIVEKIT_URL,
        apiKey: env.LIVEKIT_API_KEY,
        secret: env.LIVEKIT_API_SECRET,
        failover: false,
      })
      await livekit.agentDispatch.createDispatch(
        roomName,
        String(env.AUDIO_AGENT_NAME ?? '').trim() || DEFAULT_AUDIO_AGENT_NAME,
        { metadata },
      )
    } catch {
      throw new AudioSessionError(
        'The audio tutor could not join the meeting. Check the LiveKit settings and make sure the audio agent is running.',
        503,
      )
    }

    return {
      url: String(env.LIVEKIT_URL).trim(),
      token: jwt,
      roomName,
    }
  }

  return { getStatus, createSession }
}
