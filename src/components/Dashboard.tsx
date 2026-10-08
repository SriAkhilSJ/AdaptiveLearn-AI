import { useState } from 'react'
import {
  ArrowRight,
  Check,
  FileText,
  Home,
  Pencil,
  PlayCircle,
  Upload,
} from 'lucide-react'
import {
  getPreferenceTitle,
  getSupportTitle,
  loadProfile,
} from '../lib/profile'
import {
  loadRecentLessons,
  type RecentLesson,
} from '../lib/lessons'
import './Dashboard.css'

interface DashboardProps {
  onHome: () => void
  onEditPreferences: () => void
  onUploadLesson: () => void
  onStartLesson: () => void
  hasUploadedLesson: boolean
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function Dashboard({
  onHome,
  onEditPreferences,
  onUploadLesson,
  onStartLesson,
  hasUploadedLesson,
}: DashboardProps) {
  const profile = loadProfile()
  const [recentLessons] = useState<RecentLesson[]>(loadRecentLessons)

  const hasPreferences =
    profile.supports.length > 0 || profile.preference !== null

  return (
    <main className="dashboard">
      <div className="dashboard-inner">
        <button type="button" className="back-button" onClick={onHome}>
          <Home size={18} aria-hidden="true" />
          Home
        </button>

        <h1 className="title">Welcome back!</h1>
        <p className="subtitle">Here is your learning space.</p>

        {/* ---- Your Learning Preferences ---- */}
        <section className="dashboard-card" aria-labelledby="prefs-heading">
          <div className="card-header">
            <h2 id="prefs-heading" className="section-title">
              Your Learning Preferences
            </h2>
            <button
              type="button"
              className="link-button"
              onClick={onEditPreferences}
            >
              <Pencil size={14} aria-hidden="true" />
              Edit
            </button>
          </div>

          {hasPreferences ? (
            <dl className="prefs-display">
              <dt>Learning preference</dt>
              <dd>
                <span className="chip chip-strong">
                  {getPreferenceTitle(profile.preference)}
                </span>
              </dd>
              <dt>Learning supports</dt>
              <dd>
                {profile.supports.length > 0 ? (
                  <ul className="chip-list">
                    {profile.supports.map((id) => (
                      <li key={id} className="chip">
                        <Check size={13} aria-hidden="true" />
                        {getSupportTitle(id)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="muted">None selected</span>
                )}
              </dd>
            </dl>
          ) : (
            <div className="empty-prefs">
              <p className="muted">
                You have not set your learning preferences yet.
              </p>
              <button
                type="button"
                className="secondary-button"
                onClick={onEditPreferences}
              >
                Set up my preferences
              </button>
            </div>
          )}
        </section>

        {/* ---- Start a New Lesson (main section) ---- */}
        <section
          className="dashboard-card main-card"
          aria-labelledby="lesson-heading"
        >
          <div className="main-icon" aria-hidden="true">
            <PlayCircle size={34} strokeWidth={1.75} />
          </div>
          <h2 id="lesson-heading" className="section-title">
            Start a New Lesson
          </h2>
          <p className="muted">
            Start with a PDF and create a lesson adapted to your learning preferences.
          </p>

          <div className="main-actions">
            <button
              type="button"
              className="start-button"
              onClick={onStartLesson}
            >
              {hasUploadedLesson ? 'Continue Lesson' : 'Start Lesson'}
              <ArrowRight size={20} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={onUploadLesson}
            >
              <Upload size={16} aria-hidden="true" />
              Upload Lesson
            </button>
          </div>
        </section>

        {/* ---- Recent Lessons ---- */}
        <section className="dashboard-card" aria-labelledby="recent-heading">
          <h2 id="recent-heading" className="section-title">
            Recent Lessons
          </h2>
          {recentLessons.length > 0 ? (
            <ul className="lesson-list">
              {recentLessons.map((lesson) => (
                <li key={lesson.id} className="lesson-item">
                  <span className="lesson-icon" aria-hidden="true">
                    <FileText size={18} />
                  </span>
                  <span className="lesson-name">{lesson.name}</span>
                  <span className="lesson-date">
                    Uploaded {formatDate(lesson.uploadedAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted lesson-empty">
              No lessons yet. Start a new lesson or upload one to see it here.
            </p>
          )}
        </section>
      </div>
    </main>
  )
}
