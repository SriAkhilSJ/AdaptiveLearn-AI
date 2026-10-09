import type { AccessibilityProfile } from './profile'
import { QUESTION_DIFFICULTIES, type QuestionDifficulty } from './quiz-difficulty.mjs'

export interface UploadedLesson {
  name: string
  size: number
  pageCount: number
  text: string
}

export type VisualLayout = 'flow' | 'cycle' | 'stack' | 'comparison'

export interface VisualExplanation {
  title: string
  summary: string
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
  difficulty: QuestionDifficulty
}

export interface LessonQuiz {
  questions: LessonQuizQuestion[]
}

export interface LessonQuizFeedback {
  concept: string
  simpleExplanation: string
  visualExplanation: VisualExplanation
  example: string
}

interface AdaptationApiResponse {
  adaptations?: LessonAdaptations
  error?: string
}

interface QuizApiResponse {
  quiz?: LessonQuiz
  error?: string
}

interface QuizFeedbackApiResponse {
  feedback?: LessonQuizFeedback
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
  if (
    !payload.quiz ||
    !Array.isArray(payload.quiz.questions) ||
    payload.quiz.questions.length !== 5 ||
    payload.quiz.questions.some(
      (question) =>
        typeof question !== 'object' ||
        question === null ||
        !QUESTION_DIFFICULTIES.includes(question.difficulty),
    )
  ) {
    throw new Error('The AI service returned an incomplete quiz. Please try again.')
  }
  return payload.quiz
}

/** Generate focused reteaching after a wrong answer; the correct answer is not sent to the provider. */
export async function requestLessonQuizFeedback(
  lesson: UploadedLesson,
  question: LessonQuizQuestion,
  incorrectAnswer: string,
  explanationStyle = '',
): Promise<LessonQuizFeedback> {
  let response: Response
  try {
    response = await fetch('/api/quiz/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lesson: { title: lesson.name, text: lesson.text },
        question: {
          question: question.question,
          choices: question.choices,
          concept: question.concept,
        },
        incorrectAnswer,
        explanationStyle,
      }),
    })
  } catch {
    throw new Error(
      'The adaptive feedback service could not be reached. Check that the app server is running and try again.',
    )
  }

  let payload: QuizFeedbackApiResponse = {}
  try {
    payload = (await response.json()) as QuizFeedbackApiResponse
  } catch {
    // The response may be empty when the service is restarting.
  }

  if (!response.ok) {
    throw new Error(payload.error || 'Adaptive feedback could not be created. Please try again.')
  }
  if (
    !payload.feedback ||
    !payload.feedback.simpleExplanation ||
    !payload.feedback.example ||
    !Array.isArray(payload.feedback.visualExplanation?.items) ||
    payload.feedback.visualExplanation.items.length < 2
  ) {
    throw new Error('The AI service returned incomplete adaptive feedback. Please try again.')
  }
  return payload.feedback
}
