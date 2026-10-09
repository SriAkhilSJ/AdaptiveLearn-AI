import { useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  LoaderCircle,
  RotateCcw,
  Trophy,
} from 'lucide-react'
import {
  requestLessonQuiz,
  requestLessonQuizFeedback,
  type LessonQuiz,
  type LessonQuizFeedback,
  type UploadedLesson,
} from '../lib/adaptive'
import {
  INITIAL_ADAPTIVE_DIFFICULTY,
  selectNextQuestionIndex,
  updateAdaptiveDifficulty,
  type AdaptiveDifficultyState,
} from '../lib/quiz-difficulty.mjs'
import { VisualExplanation } from './VisualExplanation'
import './LessonQuiz.css'

interface LessonQuizProps {
  lesson: UploadedLesson
  explanationStyle?: string
}

type QuizScreen = 'intro' | 'loading' | 'question' | 'feedback-loading' | 'feedback' | 'retry' | 'retry-result' | 'results'

interface MissedQuestion {
  questionNumber: number
  question: string
  selectedAnswer: string
  correctAnswer: string
  explanation: string
}

interface QuizProgressProps {
  questionIndex: number
  totalQuestions: number
  practice?: boolean
}

interface AnswerOptionsProps {
  choices: string[]
  selectedIndex: number | null
  name: string
  onSelect: (answerIndex: number) => void
  disabled?: boolean
}

function summarizeQuiz(
  quiz: LessonQuiz,
  firstAnswers: Array<number | null>,
  questionOrder: number[],
) {
  const missedByConcept = new Map<string, MissedQuestion[]>()
  let score = 0

  questionOrder.forEach((questionIndex, position) => {
    const question = quiz.questions[questionIndex]
    const selectedIndex = firstAnswers[questionIndex]
    if (selectedIndex === question.correctIndex) {
      score += 1
      return
    }
    if (selectedIndex === null || selectedIndex === undefined) return

    const missed = missedByConcept.get(question.concept) ?? []
    missed.push({
      questionNumber: position + 1,
      question: question.question,
      selectedAnswer: question.choices[selectedIndex],
      correctAnswer: question.choices[question.correctIndex],
      explanation: question.explanation,
    })
    missedByConcept.set(question.concept, missed)
  })

  return { score, missedByConcept }
}

function QuizProgress({ questionIndex, totalQuestions, practice = false }: QuizProgressProps) {
  const progress = ((questionIndex + 1) / totalQuestions) * 100
  const label = `Question ${questionIndex + 1} of ${totalQuestions}${practice ? ', practice retry' : ''}`

  return (
    <>
      <div className="quiz-progress-heading" aria-live="polite">
        <span>{label}</span>
        <span>{Math.round(progress)}%</span>
      </div>
      <div
        className="quiz-progress-track"
        role="progressbar"
        aria-label="Quiz progress"
        aria-valuemin={1}
        aria-valuemax={totalQuestions}
        aria-valuenow={questionIndex + 1}
        aria-valuetext={label}
      >
        <span style={{ width: `${progress}%` }} />
      </div>
    </>
  )
}

function difficultyLabel(difficulty: string): string {
  return difficulty[0].toLocaleUpperCase() + difficulty.slice(1)
}

function DifficultyStatus({
  state,
  questionDifficulty,
  practice = false,
}: {
  state: AdaptiveDifficultyState
  questionDifficulty?: string
  practice?: boolean
}) {
  return (
    <div className="quiz-difficulty-status" aria-live="polite">
      <div className="quiz-difficulty-values">
        {questionDifficulty && (
          <p>
            <span>Question level</span>
            <strong className={`quiz-difficulty-badge is-${questionDifficulty}`}>
              {difficultyLabel(questionDifficulty)}
            </strong>
          </p>
        )}
        <p>
          <span>Adaptive target</span>
          <strong className={`quiz-difficulty-badge is-${state.target}`}>
            {difficultyLabel(state.target)}
          </strong>
        </p>
      </div>
      <p className="quiz-difficulty-message">
        {practice
          ? 'Practice retries do not change your score or adaptive level.'
          : state.message}
      </p>
    </div>
  )
}

function AnswerOptions({ choices, selectedIndex, name, onSelect, disabled = false }: AnswerOptionsProps) {
  return (
    <div className="quiz-options">
      {choices.map((choice, choiceIndex) => (
        <label
          className={`quiz-option${selectedIndex === choiceIndex ? ' is-selected' : ''}${disabled ? ' is-locked' : ''}`}
          key={`${choiceIndex}-${choice.slice(0, 24)}`}
        >
          <input
            type="radio"
            name={name}
            value={choiceIndex}
            checked={selectedIndex === choiceIndex}
            onChange={() => onSelect(choiceIndex)}
            disabled={disabled}
          />
          <span className="quiz-option-letter" aria-hidden="true">
            {String.fromCharCode(65 + choiceIndex)}
          </span>
          <span>{choice}</span>
        </label>
      ))}
    </div>
  )
}

function AdaptiveFeedbackContent({ feedback }: { feedback: LessonQuizFeedback }) {
  return (
    <div className="quiz-adaptive-feedback">
      <p className="quiz-feedback-lead">You may find this concept easier this way.</p>
      <p className="quiz-weak-concept">
        <span>Concept to review</span>
        <strong>{feedback.concept}</strong>
      </p>

      <section className="quiz-feedback-section" aria-labelledby="simple-feedback-heading">
        <h3 id="simple-feedback-heading">Simple explanation</h3>
        <p>{feedback.simpleExplanation}</p>
      </section>

      <section className="quiz-feedback-section quiz-feedback-visual" aria-labelledby="visual-feedback-heading">
        <h3 id="visual-feedback-heading" className="visually-hidden">Different format: visual explanation</h3>
        <VisualExplanation explanation={feedback.visualExplanation} />
      </section>

      <section className="quiz-feedback-section" aria-labelledby="example-feedback-heading">
        <h3 id="example-feedback-heading">One small example</h3>
        <p>{feedback.example}</p>
      </section>
    </div>
  )
}

export function LessonQuiz({ lesson, explanationStyle = '' }: LessonQuizProps) {
  const [screen, setScreen] = useState<QuizScreen>('intro')
  const [quiz, setQuiz] = useState<LessonQuiz | null>(null)
  const [answers, setAnswers] = useState<Array<number | null>>([])
  const [firstAnswers, setFirstAnswers] = useState<Array<number | null>>([])
  const [questionOrder, setQuestionOrder] = useState<number[]>([])
  const [questionPosition, setQuestionPosition] = useState(0)
  const [adaptiveDifficulty, setAdaptiveDifficulty] = useState(INITIAL_ADAPTIVE_DIFFICULTY)
  const [feedback, setFeedback] = useState<LessonQuizFeedback | null>(null)
  const [retryAnswer, setRetryAnswer] = useState<number | null>(null)
  const [retryWasCorrect, setRetryWasCorrect] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleCreateQuiz = async () => {
    setScreen('loading')
    setError(null)
    try {
      const generatedQuiz = await requestLessonQuiz(lesson)
      const firstQuestionIndex = selectNextQuestionIndex(
        generatedQuiz.questions,
        [],
        INITIAL_ADAPTIVE_DIFFICULTY.target,
      )
      if (firstQuestionIndex === null) throw new Error('The quiz has no available questions.')
      setQuiz(generatedQuiz)
      setAnswers(Array(generatedQuiz.questions.length).fill(null))
      setFirstAnswers(Array(generatedQuiz.questions.length).fill(null))
      setQuestionOrder([firstQuestionIndex])
      setQuestionPosition(0)
      setAdaptiveDifficulty(INITIAL_ADAPTIVE_DIFFICULTY)
      setFeedback(null)
      setScreen('question')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The quiz could not be created. Please try again.')
      setScreen('intro')
    }
  }

  const activeQuestionIndex = questionOrder[questionPosition]

  const handleSelectAnswer = (answerIndex: number) => {
    if (activeQuestionIndex === undefined || firstAnswers[activeQuestionIndex] !== null) return
    setError(null)
    setAnswers((currentAnswers) => {
      const updatedAnswers = [...currentAnswers]
      updatedAnswers[activeQuestionIndex] = answerIndex
      return updatedAnswers
    })
  }

  const advanceAfterQuestion = (nextTarget = adaptiveDifficulty.target) => {
    if (!quiz) return
    setFeedback(null)
    setRetryAnswer(null)
    setRetryWasCorrect(null)
    if (questionPosition < questionOrder.length - 1) {
      setQuestionPosition((currentPosition) => currentPosition + 1)
      setScreen('question')
      return
    }
    if (questionOrder.length >= quiz.questions.length) {
      setScreen('results')
      return
    }

    const nextQuestionIndex = selectNextQuestionIndex(quiz.questions, questionOrder, nextTarget)
    if (nextQuestionIndex === null) {
      setScreen('results')
      return
    }
    setQuestionOrder((currentOrder) => [...currentOrder, nextQuestionIndex])
    setQuestionPosition((currentPosition) => currentPosition + 1)
    setScreen('question')
  }

  const handleNext = async () => {
    if (!quiz || activeQuestionIndex === undefined) return
    const question = quiz.questions[activeQuestionIndex]
    const firstAnswer = firstAnswers[activeQuestionIndex]
    const alreadyAnswered = firstAnswer !== null && firstAnswer !== undefined
    const selectedIndex = alreadyAnswered ? firstAnswer : answers[activeQuestionIndex]
    if (selectedIndex === null || selectedIndex === undefined) return

    let nextTarget = adaptiveDifficulty.target
    if (!alreadyAnswered) {
      const nextDifficultyState = updateAdaptiveDifficulty(
        adaptiveDifficulty,
        selectedIndex === question.correctIndex,
      )
      setFirstAnswers((currentAnswers) => {
        const updatedAnswers = [...currentAnswers]
        updatedAnswers[activeQuestionIndex] = selectedIndex
        return updatedAnswers
      })
      setAdaptiveDifficulty(nextDifficultyState)
      nextTarget = nextDifficultyState.target
    }

    if (selectedIndex === question.correctIndex) {
      advanceAfterQuestion(nextTarget)
      return
    }

    setScreen('feedback-loading')
    setError(null)
    try {
      const generatedFeedback = await requestLessonQuizFeedback(
        lesson,
        question,
        question.choices[selectedIndex],
        explanationStyle,
      )
      setFeedback(generatedFeedback)
      setRetryAnswer(null)
      setRetryWasCorrect(null)
      setScreen('feedback')
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `${cause.message} Your answer is saved; select Next to try generating the feedback again.`
          : 'Adaptive feedback could not be created. Your answer is saved; select Next to try again.',
      )
      setScreen('question')
    }
  }

  const handlePrevious = () => {
    setError(null)
    setQuestionPosition((currentPosition) => Math.max(0, currentPosition - 1))
  }

  const handleStartRetry = () => {
    setRetryAnswer(null)
    setRetryWasCorrect(null)
    setScreen('retry')
  }

  const handleCheckRetry = () => {
    const question = activeQuestionIndex === undefined ? undefined : quiz?.questions[activeQuestionIndex]
    if (!question || retryAnswer === null) return
    setRetryWasCorrect(retryAnswer === question.correctIndex)
    setScreen('retry-result')
  }

  const handleTryAgain = () => {
    if (!quiz) return
    const firstQuestionIndex = selectNextQuestionIndex(
      quiz.questions,
      [],
      INITIAL_ADAPTIVE_DIFFICULTY.target,
    )
    if (firstQuestionIndex === null) return
    setAnswers(Array(quiz.questions.length).fill(null))
    setFirstAnswers(Array(quiz.questions.length).fill(null))
    setQuestionOrder([firstQuestionIndex])
    setQuestionPosition(0)
    setAdaptiveDifficulty(INITIAL_ADAPTIVE_DIFFICULTY)
    setFeedback(null)
    setRetryAnswer(null)
    setRetryWasCorrect(null)
    setError(null)
    setScreen('question')
  }

  const question = activeQuestionIndex === undefined ? undefined : quiz?.questions[activeQuestionIndex]
  const summary = screen === 'results' && quiz
    ? summarizeQuiz(quiz, firstAnswers, questionOrder)
    : null

  return (
    <section className="learning-card lesson-quiz-card" aria-labelledby="lesson-quiz-heading">
      <div className="lesson-quiz-heading">
        <span className="quiz-heading-icon" aria-hidden="true">
          <ClipboardList size={21} />
        </span>
        <div>
          <h2 id="lesson-quiz-heading">Check your understanding</h2>
          <p>A short quiz based on {lesson.name}</p>
        </div>
      </div>

      {screen === 'intro' && (
        <div className="quiz-intro">
          <p>
            Create a 5-question quiz with four answer choices per question. Your answers will show
            which lesson concepts may be worth reviewing.
          </p>
          <p className="quiz-adaptive-intro-note">
            Difficulty starts at Medium. Three consecutive correct first answers raise it one level;
            two consecutive incorrect first answers lower it one level. Practice retries do not count.
          </p>
          {error && <p className="quiz-error" role="alert">{error}</p>}
          <button type="button" className="quiz-primary-button" onClick={handleCreateQuiz}>
            <ClipboardList size={18} aria-hidden="true" />
            Create quiz
          </button>
          <p className="quiz-privacy-note">
            The uploaded lesson text is sent to your configured AI provider to create the quiz. If you miss an answer, it is also used to generate targeted feedback.
          </p>
        </div>
      )}

      {screen === 'loading' && (
        <p className="quiz-loading" role="status" aria-live="polite" aria-busy="true">
          <LoaderCircle className="quiz-spinner" size={20} aria-hidden="true" />
          Creating your quiz from the lesson…
        </p>
      )}

      {screen === 'question' && question && quiz && activeQuestionIndex !== undefined && (
        <div className="quiz-question-screen">
          <QuizProgress questionIndex={questionPosition} totalQuestions={quiz.questions.length} />
          <DifficultyStatus state={adaptiveDifficulty} questionDifficulty={question.difficulty} />
          {firstAnswers[activeQuestionIndex] !== null && (
            <p className="quiz-first-answer-note">
              Your first answer is saved and locked. Revisiting this question will not change your score or adaptive level.
            </p>
          )}
          {error && <p className="quiz-error" role="alert">{error}</p>}

          <fieldset className="quiz-question-fieldset">
            <legend className="quiz-question-prompt">{question.question}</legend>
            <AnswerOptions
              choices={question.choices}
              selectedIndex={firstAnswers[activeQuestionIndex] ?? answers[activeQuestionIndex] ?? null}
              name={`lesson-quiz-question-${activeQuestionIndex}`}
              onSelect={handleSelectAnswer}
              disabled={firstAnswers[activeQuestionIndex] !== null}
            />
          </fieldset>

          <div className="quiz-navigation">
            <button
              type="button"
              className="quiz-secondary-button"
              onClick={handlePrevious}
              disabled={questionPosition === 0}
            >
              <ArrowLeft size={17} aria-hidden="true" />
              Previous
            </button>
            <button
              type="button"
              className="quiz-primary-button"
              onClick={handleNext}
              disabled={
                (firstAnswers[activeQuestionIndex] ?? answers[activeQuestionIndex]) === null ||
                (firstAnswers[activeQuestionIndex] ?? answers[activeQuestionIndex]) === undefined
              }
            >
              {questionPosition === quiz.questions.length - 1 ? 'See results' : 'Next'}
              <ArrowRight size={17} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {screen === 'feedback-loading' && question && quiz && (
        <div className="quiz-feedback-loading" role="status" aria-live="polite" aria-busy="true">
          <QuizProgress questionIndex={questionPosition} totalQuestions={quiz.questions.length} />
          <DifficultyStatus state={adaptiveDifficulty} questionDifficulty={question.difficulty} />
          <p className="quiz-loading">
            <LoaderCircle className="quiz-spinner" size={20} aria-hidden="true" />
            Finding a simpler way to explain {question.concept}…
          </p>
        </div>
      )}

      {screen === 'feedback' && question && quiz && feedback && (
        <div className="quiz-feedback-screen">
          <QuizProgress questionIndex={questionPosition} totalQuestions={quiz.questions.length} />
          <DifficultyStatus state={adaptiveDifficulty} questionDifficulty={question.difficulty} />
          <AdaptiveFeedbackContent feedback={feedback} />
          <p className="quiz-retry-score-note">
            This retry is practice. Your quiz score is based on your first answer.
          </p>
          <div className="quiz-feedback-actions">
            <button type="button" className="quiz-primary-button" onClick={handleStartRetry}>
              Try this question again
              <RotateCcw size={17} aria-hidden="true" />
            </button>
            <button type="button" className="quiz-secondary-button" onClick={() => advanceAfterQuestion()}>
              Continue without retry
              <ArrowRight size={17} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {screen === 'retry' && question && quiz && feedback && (
        <div className="quiz-question-screen quiz-retry-screen">
          <QuizProgress questionIndex={questionPosition} totalQuestions={quiz.questions.length} practice />
          <DifficultyStatus state={adaptiveDifficulty} questionDifficulty={question.difficulty} practice />
          <p className="quiz-retry-instruction">Use the explanation, then choose an answer again.</p>
          <details className="quiz-retry-review">
            <summary>Review the simpler and visual explanations</summary>
            <AdaptiveFeedbackContent feedback={feedback} />
          </details>
          <fieldset className="quiz-question-fieldset">
            <legend className="quiz-question-prompt">{question.question}</legend>
            <AnswerOptions
              choices={question.choices}
              selectedIndex={retryAnswer}
              name={`lesson-quiz-retry-${activeQuestionIndex}`}
              onSelect={setRetryAnswer}
            />
          </fieldset>
          <div className="quiz-navigation">
            <button type="button" className="quiz-secondary-button" onClick={() => setScreen('feedback')}>
              <ArrowLeft size={17} aria-hidden="true" />
              Review feedback
            </button>
            <button
              type="button"
              className="quiz-primary-button"
              onClick={handleCheckRetry}
              disabled={retryAnswer === null}
            >
              Check retry
              <ArrowRight size={17} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {screen === 'retry-result' && question && retryWasCorrect !== null && (
        <div className="quiz-retry-result" aria-live="polite">
          <QuizProgress questionIndex={questionPosition} totalQuestions={quiz?.questions.length ?? 5} practice />
          <DifficultyStatus state={adaptiveDifficulty} questionDifficulty={question.difficulty} practice />
          {retryWasCorrect ? (
            <p className="quiz-retry-success">
              <CheckCircle2 size={20} aria-hidden="true" />
              That’s right—you used the new explanation to answer correctly.
            </p>
          ) : (
            <div className="quiz-retry-correction">
              <h3>Let’s review the key idea</h3>
              <p><strong>Correct answer:</strong> {question.choices[question.correctIndex]}</p>
              <p>{question.explanation}</p>
            </div>
          )}
          <p className="quiz-retry-score-note">
            Your score still reflects your first answer. This retry is practice.
          </p>
          <button type="button" className="quiz-primary-button" onClick={() => advanceAfterQuestion()}>
            {questionPosition === (quiz?.questions.length ?? 1) - 1 ? 'See final score' : 'Continue to next question'}
            <ArrowRight size={17} aria-hidden="true" />
          </button>
        </div>
      )}

      {screen === 'results' && quiz && summary && (
        <div className="quiz-results" aria-live="polite">
          <div className="quiz-complete-heading">
            <Trophy size={25} aria-hidden="true" />
            <h3>Quiz complete</h3>
          </div>
          <p className="quiz-score">Score: <strong>{summary.score} / 5</strong></p>

          {summary.missedByConcept.size === 0 ? (
            <p className="quiz-perfect-score">
              <CheckCircle2 size={19} aria-hidden="true" />
              Excellent work. There are no missed concepts to review.
            </p>
          ) : (
            <section className="quiz-review" aria-labelledby="quiz-review-heading">
              <h4 id="quiz-review-heading">Concepts to review</h4>
              <ul className="quiz-missed-concepts">
                {[...summary.missedByConcept.entries()].map(([concept, missedQuestions]) => (
                  <li className="quiz-missed-concept" key={concept}>
                    <h5>{concept}</h5>
                    {missedQuestions.map((missed) => (
                      <div className="quiz-missed-question" key={missed.questionNumber}>
                        <p className="quiz-review-question">
                          Question {missed.questionNumber}: {missed.question}
                        </p>
                        <p><strong>Your answer:</strong> {missed.selectedAnswer}</p>
                        <p><strong>Correct answer:</strong> {missed.correctAnswer}</p>
                        <p className="quiz-review-explanation">{missed.explanation}</p>
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <button type="button" className="quiz-primary-button" onClick={handleTryAgain}>
            <RotateCcw size={17} aria-hidden="true" />
            Try again
          </button>
        </div>
      )}
    </section>
  )
}
