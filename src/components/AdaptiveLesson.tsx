import { useState } from 'react'
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Headphones,
  Image as ImageIcon,
  LoaderCircle,
  Sparkles,
  Type,
} from 'lucide-react'
import {
  requestLessonAdaptations,
  type LessonAdaptations,
  type UploadedLesson,
} from '../lib/adaptive'
import { VisualExplanation } from './VisualExplanation'
import {
  getPreferenceTitle,
  getSupportTitle,
  loadProfile,
  type AccessibilityProfile,
} from '../lib/profile'
import './AdaptiveLesson.css'

interface AdaptiveLessonProps {
  lesson: UploadedLesson
  initialAdaptations?: LessonAdaptations | null
  onBack: () => void
  onContinueToPersonalized: (adaptations: LessonAdaptations) => void
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function SelectedPreferences({ profile }: { profile: AccessibilityProfile }) {
  const supports = profile.supports.map((id) => getSupportTitle(id))
  return (
    <div
      className="adaptation-preferences"
      role="group"
      aria-label="Preferences used for this lesson"
    >
      <span className="adaptation-preference-chip">
        Learning preference: {getPreferenceTitle(profile.preference)}
      </span>
      {supports.map((support) => (
        <span key={support} className="adaptation-preference-chip">
          {support}
        </span>
      ))}
      {supports.length === 0 && (
        <span className="adaptation-preference-chip">No extra supports selected</span>
      )}
    </div>
  )
}

export function AdaptiveLesson({
  lesson,
  initialAdaptations = null,
  onBack,
  onContinueToPersonalized,
}: AdaptiveLessonProps) {
  const [profile] = useState<AccessibilityProfile>(loadProfile)
  const [adaptations, setAdaptations] = useState<LessonAdaptations | null>(initialAdaptations)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const preferenceCount = profile.supports.length + (profile.preference ? 1 : 0)
  const preview = lesson.text.slice(0, 5000)
  const hasMoreSource = lesson.text.length > 5000

  const handleGenerate = async () => {
    setIsGenerating(true)
    setError(null)
    try {
      const result = await requestLessonAdaptations(lesson, profile)
      setAdaptations(result)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The lesson could not be adapted. Please try again.',
      )
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <main className="adaptive-screen">
      <div className="adaptive-inner">
        <button type="button" className="back-button" onClick={onBack}>
          <ArrowLeft size={18} aria-hidden="true" />
          Back to dashboard
        </button>

        <p className="adaptive-eyebrow">
          <Sparkles size={15} aria-hidden="true" />
          Adaptive learning
        </p>
        <h1 className="title">Your Personalized Lesson</h1>
        <p className="subtitle">
          The lesson is adapted using the learning preferences you saved.
        </p>

        <div className="adaptation-flow" role="group" aria-label="Lesson adaptation flow">
          <span className="flow-step">Original Lesson</span>
          <ArrowDown className="flow-arrow" size={20} aria-hidden="true" />
          <span className="flow-step">AI Adaptation</span>
          <ArrowDown className="flow-arrow" size={20} aria-hidden="true" />
          <span className="flow-step">Personalized Lesson</span>
        </div>

        <section className="adaptive-card" aria-labelledby="original-heading">
          <div className="adaptive-card-heading">
            <span className="stage-icon" aria-hidden="true">
              <BookOpen size={22} />
            </span>
            <div>
              <p className="stage-label">Step 1</p>
              <h2 id="original-heading" className="section-title">Original Lesson</h2>
            </div>
          </div>
          <p className="original-file-name">{lesson.name}</p>
          <p className="original-meta">
            {lesson.pageCount} {lesson.pageCount === 1 ? 'page' : 'pages'}
            {' · '}
            {formatFileSize(lesson.size)}
          </p>
          <details className="original-text-details">
            <summary>{hasMoreSource ? 'Preview extracted text' : 'View extracted text'}</summary>
            <pre>
              {preview}
              {hasMoreSource
                ? '\n\n… Preview shortened. The full extracted text will be sent for adaptation.'
                : ''}
            </pre>
          </details>
        </section>

        <div className="stage-connector" aria-hidden="true">
          <ArrowDown size={22} />
        </div>

        <section className="adaptive-card" aria-labelledby="ai-adaptation-heading">
          <div className="adaptive-card-heading">
            <span className="stage-icon" aria-hidden="true">
              <Sparkles size={22} />
            </span>
            <div>
              <p className="stage-label">Step 2</p>
              <h2 id="ai-adaptation-heading" className="section-title">AI Adaptation</h2>
            </div>
          </div>
          <p className="adaptive-description">
            Generate five explanation formats. Your saved preferences guide the final lesson.
          </p>
          <SelectedPreferences profile={profile} />

          {preferenceCount === 0 && (
            <p className="note preference-reminder" role="note">
              No preferences are saved yet. You can still generate balanced explanations, or go back to your dashboard to set preferences first.
            </p>
          )}

          {error && (
            <p className="adaptation-error" role="alert">
              <AlertCircle size={19} aria-hidden="true" />
              <span>{error}</span>
            </p>
          )}

          <button
            type="button"
            className="start-button generate-button"
            onClick={handleGenerate}
            disabled={isGenerating}
            aria-busy={isGenerating}
          >
            {isGenerating ? (
              <>
                <LoaderCircle className="generating-icon" size={19} aria-hidden="true" />
                Adapting lesson…
              </>
            ) : (
              <>
                <Sparkles size={18} aria-hidden="true" />
                {adaptations ? 'Generate again' : 'Generate adaptations'}
              </>
            )}
          </button>

          <p className="privacy-hint">
            The extracted lesson text and selected learning preferences are sent to the configured AI provider for this request.
          </p>

          {adaptations && (
            <>
              <p className="visually-hidden" role="status">
                All five explanations and your personalized lesson are ready.
              </p>
              <section className="adaptation-results" aria-labelledby="results-heading">
                <h3 id="results-heading" className="results-heading">Generated explanations</h3>
                <article className="result-card">
                  <h4><BookOpen size={17} aria-hidden="true" /> Standard explanation</h4>
                  <p className="result-copy">{adaptations.standardExplanation}</p>
                </article>
                <article className="result-card">
                  <h4><Type size={17} aria-hidden="true" /> Easy-to-read explanation</h4>
                  <p className="result-copy">{adaptations.easyToReadExplanation}</p>
                </article>
                <article className="result-card">
                  <h4><CheckCircle2 size={17} aria-hidden="true" /> Step-by-step explanation</h4>
                  <ol className="step-list">
                    {adaptations.stepByStepExplanation.map((step, index) => (
                      <li key={`${index}-${step.slice(0, 24)}`}>{step}</li>
                    ))}
                  </ol>
                </article>
                <article className="result-card visual-result">
                  <h4><ImageIcon size={17} aria-hidden="true" /> Visual explanation</h4>
                  <div className="result-copy visual-copy">
                    <VisualExplanation explanation={adaptations.visualExplanation} />
                  </div>
                </article>
                <article className="result-card">
                  <h4><Headphones size={17} aria-hidden="true" /> Audio-ready explanation</h4>
                  <p className="result-copy">{adaptations.audioReadyExplanation}</p>
                  <p className="audio-caption">
                    Prepared as spoken-word text. Audio playback is available on the next screen.
                  </p>
                </article>
              </section>
            </>
          )}
        </section>

        <div className="stage-connector" aria-hidden="true">
          <ArrowDown size={22} />
        </div>

        <section className="adaptive-card personalized-card" aria-labelledby="personalized-heading">
          <div className="adaptive-card-heading">
            <span className="stage-icon personalized-icon" aria-hidden="true">
              <CheckCircle2 size={22} />
            </span>
            <div>
              <p className="stage-label">Step 3</p>
              <h2 id="personalized-heading" className="section-title">Personalized Lesson</h2>
            </div>
          </div>
          {adaptations ? (
            <div
              className={`personalized-copy${profile.supports.includes('large-text') ? ' personalized-copy-large' : ''}`}
            >
              {adaptations.personalizedLesson}
            </div>
          ) : (
            <p className="muted personalized-placeholder">
              Generate the AI adaptations to see a lesson shaped around your saved learning preferences.
            </p>
          )}
          {adaptations && (
            <div className="personalized-actions">
              <button
                type="button"
                className="start-button"
                onClick={() => onContinueToPersonalized(adaptations)}
              >
                Start Personalized Learning
                <ArrowRight size={19} aria-hidden="true" />
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
