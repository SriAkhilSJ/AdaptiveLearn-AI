import { ArrowRight, GraduationCap, Sparkles } from 'lucide-react'
import './Landing.css'

interface LandingProps {
  hasSavedProfile: boolean
  onStart: () => void
}

export function Landing({ hasSavedProfile, onStart }: LandingProps) {
  return (
    <main className="landing">
      <div className="card">
        <div className="badge" aria-hidden="true">
          <GraduationCap size={42} strokeWidth={1.75} />
        </div>

        <p className="eyebrow">
          <Sparkles size={14} aria-hidden="true" />
          AI-powered personalized learning
        </p>

        <h1 className="title">AdaptiveLearn AI</h1>

        <p className="tagline">Learn in the way that works for you</p>

        <button type="button" className="start-button" onClick={onStart}>
          {hasSavedProfile ? 'Continue Learning' : 'Start Learning'}
          <ArrowRight size={20} aria-hidden="true" />
        </button>

        {hasSavedProfile && (
          <p className="landing-hint">
            Your preferences are saved — welcome back!
          </p>
        )}
      </div>

      <footer className="footer">
        <p>For students with disabilities and special educational needs</p>
      </footer>
    </main>
  )
}
