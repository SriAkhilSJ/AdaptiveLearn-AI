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

export interface LessonQuizQuestion {
  question: string
  choices: string[]
  correctIndex: number
  concept: string
  explanation: string
}

export interface LessonQuiz {
  questions: LessonQuizQuestion[]
}

interface AdaptationApiResponse {
  adaptations?: LessonAdaptations
  error?: string
}

interface QuizApiResponse {
  quiz?: LessonQuiz
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

/** Generate a five-question quiz from the uploaded lesson using the server-side AI provider. */
export async function requestLessonQuiz(lesson: UploadedLesson): Promise<LessonQuiz> {
  let response: Response
  try {
    response = await fetch('/api/quiz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lesson: { title: lesson.name, text: lesson.text },
      }),
    })
  } catch {
    throw new Error(
      'The quiz service could not be reached. Check that the app server is running and try again.',
    )
  }

  let payload: QuizApiResponse = {}
  try {
    payload = (await response.json()) as QuizApiResponse
  } catch {
    // The response may be empty when the service is restarting.
  }

  if (!response.ok) {
    throw new Error(payload.error || 'The quiz could not be created. Please try again.')
  }
  if (!payload.quiz || !Array.isArray(payload.quiz.questions) || payload.quiz.questions.length !== 5) {
    throw new Error('The AI service returned an incomplete quiz. Please try again.')
  }
  return payload.quiz
}
