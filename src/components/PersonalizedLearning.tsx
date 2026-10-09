import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Headphones,
  Image as ImageIcon,
  ListOrdered,
  MessageCircle,
  Type,
  Volume2,
  VolumeX,
} from 'lucide-react'
import type { LessonAdaptations, UploadedLesson } from '../lib/adaptive'
import { AudioTutor } from './AudioTutor'
import { ComicLesson } from './ComicLesson'
import { LessonQuiz } from './LessonQuiz'
import { VisualExplanation } from './VisualExplanation'
import {
  getPreferenceTitle,
  getSupportTitle,
  loadProfile,
  type AccessibilityProfile,
} from '../lib/profile'
import './PersonalizedLearning.css'

interface PersonalizedLearningProps {
  lesson: UploadedLesson
  adaptations: LessonAdaptations
  onBack: () => void
}

type LessonMode = 'personalized' | 'easy-text' | 'step-by-step' | 'visual' | 'audio'

const MODE_OPTIONS: ReadonlyArray<{ id: Exclude<LessonMode, 'personalized'>; label: string }> = [
  { id: 'easy-text', label: 'Easy Text' },
  { id: 'step-by-step', label: 'Step-by-Step' },
  { id: 'visual', label: 'Visual' },
  { id: 'audio', label: 'Audio' },
]

const MODE_TITLES: Record<LessonMode, string> = {
  personalized: 'Your Personalized Lesson',
  'easy-text': 'Easy Text',
  'step-by-step': 'Step-by-Step',
  visual: 'Visual Explanation',
  audio: 'Audio Tutoring Session',
}

function SelectedPreferences({ profile }: { profile: AccessibilityProfile }) {
  const supports = profile.supports.map((id) => getSupportTitle(id))
  return (
    <div className="learning-preferences" role="group" aria-label="Your saved learning preferences">
      <span className="learning-chip">
        Learning preference: {getPreferenceTitle(profile.preference)}
      </span>
      {supports.map((support) => (
        <span key={support} className="learning-chip">{support}</span>
      ))}
      {profile.explanationStyle.trim() && (
        <span className="learning-chip learning-style-chip">
          Explain it like: {profile.explanationStyle}
        </span>
      )}
    </div>
  )
}

export function PersonalizedLearning({ lesson, adaptations, onBack }: PersonalizedLearningProps) {
  const [profile] = useState<AccessibilityProfile>(loadProfile)
  const [mode, setMode] = useState<LessonMode>('personalized')
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [speechMessage, setSpeechMessage] = useState('')

  useEffect(() => () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
  }, [])

  const stopSpeech = (message = 'Browser read-aloud stopped.') => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
    setIsSpeaking(false)
    setSpeechMessage(message)
  }

  const speak = (text: string, message: string) => {
    if (
      typeof window === 'undefined' ||
      !('speechSynthesis' in window) ||
      typeof SpeechSynthesisUtterance === 'undefined'
    ) {
      setIsSpeaking(false)
      setSpeechMessage('Text-to-speech is not available in this browser. You can still read the lesson on screen.')
      return
    }

    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = navigator.language || 'en-US'
    utterance.onstart = () => {
      setIsSpeaking(true)
      setSpeechMessage(message)
    }
    utterance.onend = () => {
      setIsSpeaking(false)
      setSpeechMessage('Finished listening.')
    }
    utterance.onerror = (event) => {
      setIsSpeaking(false)
      if (event.error !== 'canceled' && event.error !== 'interrupted') {
        setSpeechMessage('Speech playback could not start. You can read the lesson on screen.')
      }
    }
    setSpeechMessage(message)
    window.speechSynthesis.speak(utterance)
  }

  const selectMode = (nextMode: LessonMode) => {
    if (nextMode === mode) return
    if (isSpeaking) stopSpeech('Browser read-aloud stopped because the lesson format changed.')
    setMode(nextMode)
    setSpeechMessage(nextMode === 'audio'
      ? 'Live audio tutoring is separate from browser read-aloud.'
      : `Showing ${MODE_TITLES[nextMode]}.`)
  }

  const getCurrentModeText = () => {
    if (mode === 'personalized') return adaptations.personalizedLesson
    if (mode === 'easy-text') return adaptations.easyToReadExplanation
    if (mode === 'step-by-step') return adaptations.stepByStepExplanation.join('\n')
    if (mode === 'visual') {
      return [
        adaptations.visualExplanation.title,
        adaptations.visualExplanation.summary,
        ...adaptations.visualExplanation.items.map((item) => `${item.label}: ${item.details.join('. ')}`),
      ].filter(Boolean).join('. ')
    }
    return ''
  }

  const handleReadAloud = () => {
    if (isSpeaking) {
      stopSpeech()
      return
    }
    const text = getCurrentModeText()
    if (text) speak(text, 'Reading the visible lesson with your browser voice. This is separate from live tutoring.')
  }

  const handleSimpler = () => selectMode('easy-text')
  const handleShowVisual = () => selectMode('visual')
  const handleExplainAgain = () => {
    setMode('step-by-step')
    speak(
      adaptations.stepByStepExplanation.join('\n'),
      'Reading the steps aloud with your browser voice.',
    )
  }

  const largeText = profile.supports.includes('large-text')

  return (
    <main className="personalized-learning-screen">
      <div className="personalized-learning-inner">
        <button type="button" className="back-button" onClick={onBack}>
          <ArrowLeft size={18} aria-hidden="true" />
          Back to adaptations
        </button>

        <p className="learning-eyebrow">
          <CheckCircle2 size={16} aria-hidden="true" />
          Lesson ready for you
        </p>
        <h1 className="title">Personalized Learning</h1>
        <p className="subtitle">Choose the format that helps you learn best.</p>

        <section className="learning-card" aria-labelledby="lesson-name-heading">
          <p className="learning-file-label">Adapted lesson</p>
          <h2 id="lesson-name-heading" className="learning-lesson-name">{lesson.name}</h2>
          <SelectedPreferences profile={profile} />
        </section>

        <section className="learning-card format-card" aria-labelledby="format-heading">
          <h2 id="format-heading" className="section-title">Choose a format</h2>
          <div className="format-switcher" role="group" aria-label="Switch lesson format">
            {MODE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`format-button${mode === option.id ? ' is-selected' : ''}`}
                aria-pressed={mode === option.id}
                onClick={() => selectMode(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>

          {mode !== 'personalized' && (
            <button
              type="button"
              className="return-personalized-button"
              onClick={() => selectMode('personalized')}
            >
              <BookOpen size={16} aria-hidden="true" />
              Show my personalized lesson
            </button>
          )}

          <article
            className={`lesson-content${largeText ? ' lesson-content-large' : ''}`}
            aria-labelledby="active-lesson-heading"
          >
            <div className="active-lesson-header">
              <span className="active-lesson-icon" aria-hidden="true">
                {mode === 'audio' ? <Headphones size={20} /> : null}
                {mode === 'visual' ? <ImageIcon size={20} /> : null}
                {mode === 'step-by-step' ? <ListOrdered size={20} /> : null}
                {(mode === 'personalized' || mode === 'easy-text') ? <BookOpen size={20} /> : null}
              </span>
              <h3 id="active-lesson-heading">{MODE_TITLES[mode]}</h3>
            </div>

            {mode === 'audio' ? (
              <AudioTutor lesson={lesson} adaptations={adaptations} profile={profile} />
            ) : mode === 'step-by-step' ? (
              <ol className="learning-step-list">
                {adaptations.stepByStepExplanation.map((step, index) => (
                  <li key={`${index}-${step.slice(0, 24)}`}>{step}</li>
                ))}
              </ol>
            ) : mode === 'visual' ? (
              <>
                <ComicLesson
                  lesson={lesson}
                  explanationStyle={profile.explanationStyle}
                  largeText={largeText}
                />
                <details className="visual-diagram-details">
                  <summary>Show overview diagram</summary>
                  <VisualExplanation explanation={adaptations.visualExplanation} />
                </details>
              </>
            ) : (
              <div className="learning-prose">
                {mode === 'personalized' && adaptations.personalizedLesson}
                {mode === 'easy-text' && adaptations.easyToReadExplanation}
              </div>
            )}
          </article>

          {mode !== 'audio' && (
            <div className="learning-actions" role="group" aria-label="Lesson actions">
              <button
                type="button"
                className="learning-action-button listen-button"
                aria-pressed={isSpeaking}
                onClick={handleReadAloud}
              >
                {isSpeaking ? <VolumeX size={18} aria-hidden="true" /> : <Volume2 size={18} aria-hidden="true" />}
                {isSpeaking ? 'Stop browser read-aloud' : 'Read aloud (browser voice)'}
              </button>
              <button type="button" className="learning-action-button" onClick={handleSimpler}>
                <Type size={18} aria-hidden="true" />
                Explain More Simply
              </button>
              <button type="button" className="learning-action-button" onClick={handleShowVisual}>
                <ImageIcon size={18} aria-hidden="true" />
                Show Visual
              </button>
              <button type="button" className="learning-action-button" onClick={handleExplainAgain}>
                <MessageCircle size={18} aria-hidden="true" />
                Explain Again
              </button>
            </div>
          )}
          {mode !== 'audio' && (
            <p className="speech-status" role="status" aria-live="polite">
              {speechMessage || 'Browser read-aloud uses your device voice; it is separate from live audio tutoring.'}
            </p>
          )}
        </section>

        <LessonQuiz lesson={lesson} explanationStyle={profile.explanationStyle} />
      </div>
    </main>
  )
}
