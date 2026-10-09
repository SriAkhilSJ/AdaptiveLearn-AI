import { useState } from 'react'
import {
  ArrowLeft,
  BookOpen,
  Check,
  Info,
  ListOrdered,
  Image as ImageIcon,
  Repeat,
  Type,
  Volume2,
  type LucideIcon,
} from 'lucide-react'
import {
  PREFERENCE_OPTIONS,
  SUPPORT_OPTIONS,
  loadProfile,
  saveProfile,
  type AccessibilityProfile,
  type LearningPreference,
  type SupportOptionId,
} from '../lib/profile'
import './AccessibilityProfile.css'

const SUPPORT_ICONS: Record<SupportOptionId, LucideIcon> = {
  'easy-text': BookOpen,
  audio: Volume2,
  visual: ImageIcon,
  steps: ListOrdered,
  'large-text': Type,
  repetition: Repeat,
}

interface AccessibilityProfileProps {
  onBack: () => void
  onContinue: () => void
}

export function AccessibilityProfile({
  onBack,
  onContinue,
}: AccessibilityProfileProps) {
  // Pre-fill from the saved profile so returning students keep their choices.
  const [profile, setProfile] = useState<AccessibilityProfile>(loadProfile)

  const toggleSupport = (id: SupportOptionId) => {
    setProfile((current) => ({
      ...current,
      supports: current.supports.includes(id)
        ? current.supports.filter((s) => s !== id)
        : [...current.supports, id],
    }))
  }

  const selectPreference = (value: LearningPreference) => {
    setProfile((current) => ({ ...current, preference: value }))
  }

  const updateExplanationStyle = (explanationStyle: string) => {
    setProfile((current) => ({ ...current, explanationStyle: explanationStyle.slice(0, 160) }))
  }

  const handleContinue = () => {
    saveProfile(profile)
    onContinue()
  }

  return (
    <main className="profile-screen">
      <div className="profile-card">
        <button type="button" className="back-button" onClick={onBack}>
          <ArrowLeft size={18} aria-hidden="true" />
          Back
        </button>

        <h1 className="title">Tell us how you learn best</h1>
        <p className="subtitle">
          Choose the options that help you understand lessons better.
        </p>

        <p className="note" role="note">
          <Info size={18} aria-hidden="true" />
          These are learning preferences — they help us personalize your
          lessons. This is not a medical diagnosis.
        </p>

        <section aria-labelledby="supports-heading">
          <h2 id="supports-heading" className="section-title">
            Learning supports
          </h2>
          <p className="section-hint">Select all that apply.</p>

          <div className="supports-grid">
            {SUPPORT_OPTIONS.map((option) => {
              const Icon = SUPPORT_ICONS[option.id]
              return (
                <label key={option.id} className="support-card">
                  <input
                    type="checkbox"
                    className="visually-hidden"
                    checked={profile.supports.includes(option.id)}
                    onChange={() => toggleSupport(option.id)}
                  />
                  <span className="support-icon" aria-hidden="true">
                    <Icon size={26} strokeWidth={1.75} />
                  </span>
                  <span className="support-title">{option.title}</span>
                  <span className="support-desc">{option.description}</span>
                  <span className="check-badge" aria-hidden="true">
                    <Check size={14} strokeWidth={3} />
                  </span>
                </label>
              )
            })}
          </div>
        </section>

        <fieldset className="preference-fieldset">
          <legend className="section-title">Learning preference</legend>
          <div className="preference-options">
            {PREFERENCE_OPTIONS.map((option) => (
              <label key={option.value} className="preference-pill">
                <input
                  type="radio"
                  name="learning-preference"
                  className="visually-hidden"
                  value={option.value}
                  checked={profile.preference === option.value}
                  onChange={() => selectPreference(option.value)}
                />
                <span className="preference-title">{option.title}</span>
                <span className="preference-desc">{option.description}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <section className="explanation-style-section" aria-labelledby="explanation-style-heading">
          <h2 id="explanation-style-heading" className="section-title">
            Story or personification style <span>(optional)</span>
          </h2>
          <p className="section-hint">
            Tell us what kind of story, analogy, or teaching voice would make a lesson click for you.
          </p>
          <label className="explanation-style-label" htmlFor="explanation-style">
            Explain it like…
          </label>
          <textarea
            id="explanation-style"
            className="explanation-style-input"
            value={profile.explanationStyle}
            onChange={(event) => updateExplanationStyle(event.target.value)}
            maxLength={160}
            rows={3}
            placeholder="For example: Explain it like a One Piece anime adventure"
            aria-describedby="explanation-style-help explanation-style-count"
          />
          <div className="explanation-style-footer">
            <p id="explanation-style-help">
              Your style guides the personalized lesson and audio-ready explanation. The lesson’s facts still come from the PDF.
            </p>
            <p id="explanation-style-count" className="explanation-style-count">
              {profile.explanationStyle.length} / 160
            </p>
          </div>
        </section>

        <div className="profile-actions">
          <button
            type="button"
            className="start-button"
            onClick={handleContinue}
          >
            Continue
          </button>
        </div>
      </div>
    </main>
  )
}
