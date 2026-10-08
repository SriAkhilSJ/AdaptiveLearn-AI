import { useState } from 'react'
import { ThemeToggle } from './components/ThemeToggle'
import { Landing } from './components/Landing'
import { AccessibilityProfile } from './components/AccessibilityProfile'
import { Dashboard } from './components/Dashboard'
import { UploadLesson } from './components/UploadLesson'
import { loadProfile } from './lib/profile'
import './App.css'

type View = 'landing' | 'profile' | 'dashboard' | 'upload'

function App() {
  const [view, setView] = useState<View>('landing')

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
        />
      )}
      {view === 'upload' && (
        <UploadLesson
          onBack={() => setView('dashboard')}
          onContinue={() => setView('dashboard')}
        />
      )}
    </>
  )
}

export default App
