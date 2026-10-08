import { useState } from 'react'
import { ThemeToggle } from './components/ThemeToggle'
import { Landing } from './components/Landing'
import { AccessibilityProfile } from './components/AccessibilityProfile'
import { Dashboard } from './components/Dashboard'
import { UploadLesson } from './components/UploadLesson'
import { AdaptiveLesson } from './components/AdaptiveLesson'
import { loadProfile } from './lib/profile'
import type { UploadedLesson } from './lib/adaptive'
import './App.css'

type View = 'landing' | 'profile' | 'dashboard' | 'upload' | 'adaptation'

function App() {
  const [view, setView] = useState<View>('landing')
  const [uploadedLesson, setUploadedLesson] = useState<UploadedLesson | null>(null)

  // Read on each render so the landing screen reflects the latest saved state.
  const savedProfile = loadProfile()
  const hasSavedProfile =
    savedProfile.supports.length > 0 || savedProfile.preference !== null

  return (
    <>
      <ThemeToggle />
      {view === 'landing' && (
        <Landing
          hasSavedProfile={hasSavedProfile}
          onStart={() => setView(hasSavedProfile ? 'dashboard' : 'profile')}
        />
      )}
      {view === 'profile' && (
        <AccessibilityProfile
          onBack={() => setView('landing')}
          onContinue={() => setView('dashboard')}
        />
      )}
      {view === 'dashboard' && (
        <Dashboard
          onHome={() => setView('landing')}
          onEditPreferences={() => setView('profile')}
          onUploadLesson={() => setView('upload')}
          onStartLesson={() => setView(uploadedLesson ? 'adaptation' : 'upload')}
          hasUploadedLesson={uploadedLesson !== null}
        />
      )}
      {view === 'upload' && (
        <UploadLesson
          onBack={() => setView('dashboard')}
          onContinue={(lesson) => {
            setUploadedLesson(lesson)
            setView('adaptation')
          }}
        />
      )}
      {view === 'adaptation' && uploadedLesson && (
        <AdaptiveLesson
          lesson={uploadedLesson}
          onBack={() => setView('dashboard')}
        />
      )}
    </>
  )
}

export default App
