import type { AccessibilityProfile } from './profile'

export interface UploadedLesson {
  name: string
  size: number
  pageCount: number
  text: string
}

export type VisualLayout = 'flow' | 'stack' | 'comparison'

export interface VisualExplanation {
  title: string
  layout: VisualLayout
  items: Array<{
    label: string
    details: string[]
  }>
}

export interface LessonAdaptations {
  standardExplanation: string
  easyToReadExplanation: string
  stepByStepExplanation: string[]
  visualExplanation: VisualExplanation
  audioReadyExplanation: string
  personalizedLesson: string
}

interface AdaptationApiResponse {
  adaptations?: LessonAdaptations
  error?: string
}

/** Client-side API boundary. Requests stay same-origin; Vite proxies /api to the server. */
export async function requestLessonAdaptations(
  lesson: UploadedLesson,
  profile: AccessibilityProfile,
): Promise<LessonAdaptations> {
  let response: Response
  try {
    response = await fetch('/api/adapt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lesson: { title: lesson.name, text: lesson.text },
        profile,
      }),
    })
  } catch {
    throw new Error(
      'The AI service could not be reached. Check that the app server is running and try again.',
    )
  }

  let payload: AdaptationApiResponse = {}
  try {
    payload = (await response.json()) as AdaptationApiResponse
  } catch {
    // The response may be empty when the service is restarting.
  }

  if (!response.ok) {
    throw new Error(payload.error || 'The lesson could not be adapted. Please try again.')
  }
  if (!payload.adaptations) {
    throw new Error('The AI service returned an incomplete lesson. Please try again.')
  }
  return payload.adaptations
}
