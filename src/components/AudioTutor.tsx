import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  LoaderCircle,
  Mic,
  MicOff,
  PhoneOff,
  Radio,
} from 'lucide-react'
import type { Participant, Room as LiveKitRoom, TranscriptionSegment } from 'livekit-client'
import type { LessonAdaptations, UploadedLesson } from '../lib/adaptive'
import type { AccessibilityProfile } from '../lib/profile'
import './AudioTutor.css'

interface AudioTutorProps {
  lesson: UploadedLesson
  adaptations: LessonAdaptations
  profile: AccessibilityProfile
}

interface AudioTutorStatus {
  configured: boolean
  missing: string[]
}

interface AudioSession {
  url: string
  token: string
  roomName: string
}

interface TranscriptEntry {
  id: string
  speaker: 'You' | 'Tutor'
  text: string
}

type SessionPhase = 'idle' | 'connecting' | 'waiting' | 'connected' | 'ended' | 'error'

interface ApiPayload<T> {
  session?: T
  configured?: boolean
  missing?: string[]
  error?: string
}

function isAgentParticipant(participant: Pick<Participant, 'isAgent'>): boolean {
  return participant.isAgent
}

function speakerFor(participant?: Pick<Participant, 'isAgent'>): 'You' | 'Tutor' {
  return participant && isAgentParticipant(participant) ? 'Tutor' : 'You'
}

function mergeTranscript(
  previous: TranscriptEntry[],
  segments: TranscriptionSegment[],
  speaker: 'You' | 'Tutor',
  participantIdentity: string,
): TranscriptEntry[] {
  const next = [...previous]
  for (const segment of segments) {
    const text = segment.text.trim()
    if (!segment.final || !text) continue
    const id = `${participantIdentity}:${segment.id}`
    const existingIndex = next.findIndex((entry) => entry.id === id)
    if (existingIndex >= 0) {
      next[existingIndex] = { id, speaker, text }
    } else {
      next.push({ id, speaker, text })
    }
  }
  return next.slice(-60)
}

export function AudioTutor({ lesson, adaptations, profile }: AudioTutorProps) {
  const [setup, setSetup] = useState<AudioTutorStatus | null>(null)
  const [setupError, setSetupError] = useState('')
  const [phase, setPhase] = useState<SessionPhase>('idle')
  const [statusMessage, setStatusMessage] = useState('Checking audio tutor setup…')
  const [errorMessage, setErrorMessage] = useState('')
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [microphoneEnabled, setMicrophoneEnabled] = useState(false)
  const [tutorSpeaking, setTutorSpeaking] = useState(false)
  const [audioPlaybackNeedsGesture, setAudioPlaybackNeedsGesture] = useState(false)
  const roomRef = useRef<LiveKitRoom | null>(null)
  const audioElementRef = useRef<HTMLAudioElement | null>(null)
  const agentWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestInProgressRef = useRef(false)
  const mountedRef = useRef(false)
  const startAbortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    let cancelled = false
    mountedRef.current = true
    fetch('/api/audio/status')
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as ApiPayload<never>
        if (!response.ok) throw new Error(payload.error || 'Audio tutor setup could not be checked.')
        if (!cancelled) {
          setSetup({ configured: payload.configured === true, missing: payload.missing ?? [] })
          setStatusMessage(
            payload.configured
              ? 'Ready when you are. Choose Start conversation to join your tutor.'
              : 'Audio tutoring needs a little setup before it can start.',
          )
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setSetupError(error instanceof Error ? error.message : 'Audio tutor setup could not be checked.')
          setStatusMessage('The audio tutor service could not be reached.')
        }
      })

    return () => {
      cancelled = true
      mountedRef.current = false
      startAbortControllerRef.current?.abort()
      startAbortControllerRef.current = null
      if (agentWaitTimerRef.current) clearTimeout(agentWaitTimerRef.current)
      const room = roomRef.current
      roomRef.current = null
      room?.disconnect()
    }
  }, [])

  const clearAgentWaitTimer = () => {
    if (agentWaitTimerRef.current) {
      clearTimeout(agentWaitTimerRef.current)
      agentWaitTimerRef.current = null
    }
  }

  const disconnectRoom = () => {
    clearAgentWaitTimer()
    const room = roomRef.current
    roomRef.current = null
    if (room) {
      const audioElement = audioElementRef.current
      if (audioElement) {
        room.remoteParticipants.forEach((participant) => {
          participant.trackPublications.forEach((publication) => {
            publication.track?.detach(audioElement)
          })
        })
      }
      room.disconnect()
    }
    setMicrophoneEnabled(false)
    setTutorSpeaking(false)
    setAudioPlaybackNeedsGesture(false)
  }

  const markTutorConnected = (room: LiveKitRoom) => {
    if (roomRef.current !== room) return
    clearAgentWaitTimer()
    setPhase('connected')
    setStatusMessage('Your tutor is here. Speak naturally; you can pause or interrupt at any time.')
  }

  const handleStart = async () => {
    if (requestInProgressRef.current || !setup?.configured) return
    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMessage('Microphone access needs a secure connection. Open the app on HTTPS or localhost, then try again.')
      setPhase('error')
      return
    }

    requestInProgressRef.current = true
    const controller = new AbortController()
    startAbortControllerRef.current = controller
    setErrorMessage('')
    setTranscript([])
    setPhase('connecting')
    setStatusMessage('Starting a private audio meeting…')

    try {
      const response = await fetch('/api/audio/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          lesson: { title: lesson.name, text: lesson.text },
          adaptations: {
            personalizedLesson: adaptations.personalizedLesson,
            easyToReadExplanation: adaptations.easyToReadExplanation,
            stepByStepExplanation: adaptations.stepByStepExplanation,
          },
          profile,
        }),
      })
      const payload = (await response.json().catch(() => ({}))) as ApiPayload<AudioSession>
      if (!response.ok || !payload.session) {
        throw new Error(payload.error || 'The audio meeting could not be started. Please try again.')
      }
      if (!mountedRef.current || controller.signal.aborted) return

      const session = payload.session
      const { Room, RoomEvent, Track } = await import('livekit-client')
      if (!mountedRef.current || controller.signal.aborted) return
      const room = new Room({ adaptiveStream: true, dynacast: true })
      roomRef.current = room

      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (roomRef.current !== room || track.kind !== Track.Kind.Audio || !audioElementRef.current) return
        track.attach(audioElementRef.current)
        void room.startAudio().then(() => {
          if (roomRef.current === room) setAudioPlaybackNeedsGesture(false)
        }).catch(() => {
          if (roomRef.current !== room) return
          setAudioPlaybackNeedsGesture(true)
          setStatusMessage('Your tutor is connected. Select Enable tutor audio if you cannot hear them.')
        })
      })
      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        if (roomRef.current === room && track.kind === Track.Kind.Audio && audioElementRef.current) {
          track.detach(audioElementRef.current)
        }
      })
      room.on(RoomEvent.TranscriptionReceived, (segments, participant) => {
        if (roomRef.current !== room) return
        setTranscript((previous) => mergeTranscript(
          previous,
          segments,
          speakerFor(participant),
          participant?.identity ?? 'unknown',
        ))
      })
      room.on(RoomEvent.ParticipantConnected, (participant) => {
        if (isAgentParticipant(participant)) markTutorConnected(room)
      })
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        if (roomRef.current !== room) return
        const isSpeaking = speakers.some(isAgentParticipant)
        setTutorSpeaking(isSpeaking)
        setStatusMessage(isSpeaking ? 'Your tutor is speaking.' : 'Your turn. Speak whenever you are ready.')
      })
      room.on(RoomEvent.Disconnected, () => {
        if (roomRef.current === room) {
          roomRef.current = null
          clearAgentWaitTimer()
          setMicrophoneEnabled(false)
          setTutorSpeaking(false)
          setPhase('ended')
          setStatusMessage('The meeting has ended.')
        }
      })

      await room.connect(session.url, session.token)
      if (!mountedRef.current || controller.signal.aborted || roomRef.current !== room) {
        room.disconnect()
        return
      }
      await room.localParticipant.setMicrophoneEnabled(true)
      if (!mountedRef.current || controller.signal.aborted || roomRef.current !== room) {
        room.disconnect()
        return
      }
      setMicrophoneEnabled(true)
      setPhase('waiting')
      setStatusMessage('Microphone is on. Connecting to your tutor…')

      const connectedAgent = [...room.remoteParticipants.values()].some(isAgentParticipant)
      if (connectedAgent) {
        markTutorConnected(room)
      } else {
        agentWaitTimerRef.current = setTimeout(() => {
          if (roomRef.current !== room) return
          setErrorMessage('Your tutor did not join. Check that the audio agent is running, then end this meeting and try again.')
          setPhase('error')
          setStatusMessage('The meeting could not connect to a tutor.')
          disconnectRoom()
        }, 35_000)
      }
    } catch (error) {
      if (mountedRef.current && !controller.signal.aborted) {
        disconnectRoom()
        setPhase('error')
        setStatusMessage('The audio meeting could not start.')
        setErrorMessage(error instanceof Error ? error.message : 'The audio meeting could not start. Please try again.')
      }
    } finally {
      requestInProgressRef.current = false
      if (startAbortControllerRef.current === controller) startAbortControllerRef.current = null
    }
  }

  const handleToggleMicrophone = async () => {
    const room = roomRef.current
    if (!room) return
    const nextEnabled = !microphoneEnabled
    try {
      await room.localParticipant.setMicrophoneEnabled(nextEnabled)
      setMicrophoneEnabled(nextEnabled)
      setStatusMessage(nextEnabled ? 'Microphone is on. Speak whenever you are ready.' : 'Microphone is muted.')
    } catch {
      setErrorMessage('The microphone setting could not be changed. Check browser microphone permission and try again.')
    }
  }

  const handleEnableTutorAudio = async () => {
    const room = roomRef.current
    if (!room) return
    try {
      await room.startAudio()
      setAudioPlaybackNeedsGesture(false)
      setStatusMessage('Tutor audio is enabled. Speak whenever you are ready.')
    } catch {
      setErrorMessage('Tutor audio is still blocked. Check browser audio output and try again.')
    }
  }

  const handleEnd = () => {
    disconnectRoom()
    setPhase('ended')
    setStatusMessage('Meeting ended. You can start a new conversation whenever you are ready.')
  }

  const isInMeeting = phase === 'waiting' || phase === 'connected'
  const canStart = setup?.configured === true && phase !== 'connecting' && !isInMeeting

  return (
    <section
      className={`audio-tutor-panel${profile.supports.includes('large-text') ? ' is-large-text' : ''}`}
      aria-labelledby="audio-tutor-title"
    >
      <div className="audio-tutor-heading">
        <div className={`audio-tutor-orb${phase === 'connected' ? ' is-connected' : ''}${tutorSpeaking ? ' is-speaking' : ''}`} aria-hidden="true">
          <Radio size={25} />
        </div>
        <div>
          <h4 id="audio-tutor-title">Talk it through with your tutor</h4>
          <p className="audio-tutor-intro">
            A live, lesson-grounded conversation — not a read-aloud. Your tutor will ask what you want to work through and respond to you.
          </p>
        </div>
      </div>

      <div className="audio-tutor-call-card">
        <div className="audio-tutor-call-status">
          <span className={`audio-tutor-status-dot ${isInMeeting ? 'is-live' : ''}${tutorSpeaking ? ' is-speaking' : ''}`} aria-hidden="true" />
          <p role="status" aria-live="polite">{statusMessage}</p>
        </div>

        {setup === null && !setupError && (
          <p className="audio-tutor-setup-loading"><LoaderCircle size={16} className="audio-tutor-spinner" aria-hidden="true" /> Checking setup…</p>
        )}

        {setup && !setup.configured && (
          <div className="audio-tutor-setup-note" role="note">
            <strong>Audio service setup needed</strong>
            <p>Set the missing server-side values in your local <code>.env</code> file, then restart the app:</p>
            <ul>
              {setup.missing.map((name) => <li key={name}><code>{name}</code></li>)}
            </ul>
            <p className="audio-tutor-worker-note">Also keep <code>npm run dev:audio-agent</code> running in a second terminal during local testing.</p>
          </div>
        )}

        {setupError && (
          <p className="audio-tutor-error" role="alert"><AlertCircle size={17} aria-hidden="true" />{setupError}</p>
        )}

        {errorMessage && (
          <p className="audio-tutor-error" role="alert"><AlertCircle size={17} aria-hidden="true" />{errorMessage}</p>
        )}

        <div className="audio-tutor-controls" role="group" aria-label="Audio meeting controls">
          {isInMeeting ? (
            <>
              {audioPlaybackNeedsGesture && (
                <button
                  type="button"
                  className="audio-tutor-control-button is-primary"
                  onClick={handleEnableTutorAudio}
                >
                  <Radio size={18} aria-hidden="true" />
                  Enable tutor audio
                </button>
              )}
              <button
                type="button"
                className={`audio-tutor-control-button${microphoneEnabled ? ' is-primary' : ''}`}
                aria-pressed={microphoneEnabled}
                onClick={handleToggleMicrophone}
              >
                {microphoneEnabled ? <Mic size={18} aria-hidden="true" /> : <MicOff size={18} aria-hidden="true" />}
                {microphoneEnabled ? 'Mute microphone' : 'Turn microphone on'}
              </button>
              <button type="button" className="audio-tutor-control-button is-end" onClick={handleEnd}>
                <PhoneOff size={18} aria-hidden="true" />
                End meeting
              </button>
            </>
          ) : (
            <button
              type="button"
              className="audio-tutor-control-button is-primary audio-tutor-start-button"
              disabled={!canStart}
              onClick={handleStart}
            >
              {phase === 'connecting'
                ? <LoaderCircle size={18} className="audio-tutor-spinner" aria-hidden="true" />
                : <Mic size={18} aria-hidden="true" />}
              {phase === 'connecting' ? 'Connecting…' : phase === 'ended' ? 'Start a new conversation' : 'Start conversation'}
            </button>
          )}
        </div>

        <p className="audio-tutor-privacy-note">
          Your microphone starts only after you select Start. Live audio is processed by the configured speech service; lesson context and transcripts go to your configured language model. The tutor does not start a LiveKit session recording, but provider retention policies may apply.
        </p>
      </div>

      <div className="audio-tutor-transcript" aria-label="Conversation transcript">
        <div className="audio-tutor-transcript-heading">
          <h5>Conversation transcript</h5>
          <span>Updates as you talk</span>
        </div>
        {transcript.length ? (
          <ol className="audio-tutor-transcript-list" role="log" aria-live="polite" aria-relevant="additions text">
            {transcript.map((entry) => (
              <li key={entry.id} className={`audio-tutor-transcript-entry is-${entry.speaker.toLowerCase()}`}>
                <span>{entry.speaker}</span>
                <p>{entry.text}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="audio-tutor-transcript-empty">Your conversation will appear here after you start.</p>
        )}
      </div>
      <audio ref={audioElementRef} className="audio-tutor-audio" autoPlay playsInline aria-hidden="true" />
    </section>
  )
}
