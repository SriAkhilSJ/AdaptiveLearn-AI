/**
 * Student Accessibility Profile — Work #2
 *
 * IMPORTANT: these are *learning preferences*, not medical diagnoses.
 * Nothing in the app should frame them as an assessment or diagnosis
 * of the student — they only describe how the student likes to learn.
 */

export type SupportOptionId =
  | 'easy-text'
  | 'audio'
  | 'visual'
  | 'steps'
  | 'large-text'
  | 'repetition'

export type LearningPreference = 'text' | 'audio' | 'visual' | 'mixed'

export interface AccessibilityProfile {
  /** Multi-select learning supports (any combination, including none). */
  supports: SupportOptionId[]
  /** Single overall learning preference. */
  preference: LearningPreference | null
}

export const EMPTY_PROFILE: AccessibilityProfile = {
  supports: [],
  preference: null,
}

export const SUPPORT_OPTIONS: ReadonlyArray<{
  id: SupportOptionId
  title: string
  description: string
}> = [
  {
    id: 'easy-text',
    title: 'Easy-to-read text',
    description: 'Short sentences and simple words',
  },
  {
    id: 'audio',
    title: 'Audio explanation',
    description: 'Hear the lesson read aloud',
  },
  {
    id: 'visual',
    title: 'Visual explanation',
    description: 'Pictures, diagrams, and colors',
  },
  {
    id: 'steps',
    title: 'Simple step-by-step explanation',
    description: 'One small step at a time',
  },
  {
    id: 'large-text',
    title: 'Larger text',
    description: 'Bigger letters on the screen',
  },
  {
    id: 'repetition',
    title: 'More repetition',
    description: 'Practice the same idea more times',
  },
]

export const PREFERENCE_OPTIONS: ReadonlyArray<{
  value: LearningPreference
  title: string
  description: string
}> = [
  { value: 'text', title: 'Text', description: 'Reading' },
  { value: 'audio', title: 'Audio', description: 'Listening' },
  { value: 'visual', title: 'Visual', description: 'Pictures and diagrams' },
  { value: 'mixed', title: 'Mixed', description: 'A bit of everything' },
]

const STORAGE_KEY = 'adaptivelearn-profile'

const SUPPORT_IDS = new Set<string>(SUPPORT_OPTIONS.map((o) => o.id))
const PREFERENCE_VALUES = new Set<string>(PREFERENCE_OPTIONS.map((o) => o.value))

/** Load the saved profile from localStorage (empty profile if none/invalid). */
export function loadProfile(): AccessibilityProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY_PROFILE
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return EMPTY_PROFILE
    const { supports, preference } = parsed as Record<string, unknown>
    return {
      supports: Array.isArray(supports)
        ? supports.filter(
            (s): s is SupportOptionId =>
              typeof s === 'string' && SUPPORT_IDS.has(s),
          )
        : [],
      preference:
        typeof preference === 'string' && PREFERENCE_VALUES.has(preference)
          ? (preference as LearningPreference)
          : null,
    }
  } catch {
    return EMPTY_PROFILE
  }
}

/** Save the profile to localStorage. */
export function saveProfile(profile: AccessibilityProfile): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile))
  } catch {
    // Storage unavailable (e.g. private mode) — the in-memory profile still applies.
  }
}

export function getSupportTitle(id: SupportOptionId): string {
  return SUPPORT_OPTIONS.find((o) => o.id === id)?.title ?? id
}

export function getPreferenceTitle(value: LearningPreference | null): string {
  if (!value) return 'Not selected'
  return PREFERENCE_OPTIONS.find((o) => o.value === value)?.title ?? value
}
