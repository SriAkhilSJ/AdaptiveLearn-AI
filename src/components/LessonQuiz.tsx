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
import { requestLessonQuiz, type LessonQuiz, type UploadedLesson } from '../lib/adaptive'
import './LessonQuiz.css'

interface LessonQuizProps {
  lesson: UploadedLesson
}

type QuizScreen = 'intro' | 'loading' | 'question' | 'results'

interface MissedQuestion {
  questionNumber: number
  question: string
  selectedAnswer: string
  correctAnswer: string
  explanation: string
}

function summarizeQuiz(quiz: LessonQuiz, answers: Array<number | null>) {
  const missedByConcept = new Map<string, MissedQuestion[]>()
  let score = 0

  quiz.questions.forEach((question, index) => {
    const selectedIndex = answers[index]
    if (selectedIndex === question.correctIndex) {
      score += 1
      return
    }
    if (selectedIndex === null || selectedIndex === undefined) return

    const missed = missedByConcept.get(question.concept) ?? []
    missed.push({
      questionNumber: index + 1,
      question: question.question,
      selectedAnswer: question.choices[selectedIndex],
      correctAnswer: question.choices[question.correctIndex],
      explanation: question.explanation,
    })
    missedByConcept.set(question.concept, missed)
  })

  return { score, missedByConcept }
}

export function LessonQuiz({ lesson }: LessonQuizProps) {
  const [screen, setScreen] = useState<QuizScreen>('intro')
  const [quiz, setQuiz] = useState<LessonQuiz | null>(null)
  const [answers, setAnswers] = useState<Array<number | null>>([])
  const [questionIndex, setQuestionIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const handleCreateQuiz = async () => {
    setScreen('loading')
    setError(null)
    try {
      const generatedQuiz = await requestLessonQuiz(lesson)
      setQuiz(generatedQuiz)
      setAnswers(Array(generatedQuiz.questions.length).fill(null))
      setQuestionIndex(0)
      setScreen('question')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The quiz could not be created. Please try again.')
      setScreen('intro')
    }
  }

  const handleSelectAnswer = (answerIndex: number) => {
    setAnswers((currentAnswers) => {
      const updatedAnswers = [...currentAnswers]
      updatedAnswers[questionIndex] = answerIndex
      return updatedAnswers
    })
  }

  const handleNext = () => {
    if (!quiz || answers[questionIndex] === null || answers[questionIndex] === undefined) return
    if (questionIndex === quiz.questions.length - 1) {
      setScreen('results')
      return
    }
    setQuestionIndex((currentIndex) => currentIndex + 1)
  }

  const handlePrevious = () => {
    setQuestionIndex((currentIndex) => Math.max(0, currentIndex - 1))
  }

  const handleTryAgain = () => {
    if (!quiz) return
    setAnswers(Array(quiz.questions.length).fill(null))
    setQuestionIndex(0)
    setScreen('question')
  }

  const question = quiz?.questions[questionIndex]
  const progress = quiz ? ((questionIndex + 1) / quiz.questions.length) * 100 : 0
  const summary = screen === 'results' && quiz ? summarizeQuiz(quiz, answers) : null

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
          {error && <p className="quiz-error" role="alert">{error}</p>}
          <button type="button" className="quiz-primary-button" onClick={handleCreateQuiz}>
            <ClipboardList size={18} aria-hidden="true" />
            Create quiz
          </button>
          <p className="quiz-privacy-note">
            The uploaded lesson text is sent to your configured AI provider only when you create the quiz.
          </p>
        </div>
      )}

      {screen === 'loading' && (
        <p className="quiz-loading" role="status" aria-live="polite" aria-busy="true">
          <LoaderCircle className="quiz-spinner" size={20} aria-hidden="true" />
          Creating your quiz from the lesson…
        </p>
      )}

      {screen === 'question' && question && quiz && (
        <div className="quiz-question-screen">
          <div className="quiz-progress-heading" aria-live="polite">
            <span>Question {questionIndex + 1} of {quiz.questions.length}</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div
            className="quiz-progress-track"
            role="progressbar"
            aria-label="Quiz progress"
            aria-valuemin={1}
            aria-valuemax={quiz.questions.length}
            aria-valuenow={questionIndex + 1}
            aria-valuetext={`Question ${questionIndex + 1} of ${quiz.questions.length}`}
          >
            <span style={{ width: `${progress}%` }} />
          </div>

          <fieldset className="quiz-question-fieldset">
            <legend className="quiz-question-prompt">{question.question}</legend>
            <div className="quiz-options">
              {question.choices.map((choice, choiceIndex) => (
                <label
                  className={`quiz-option${answers[questionIndex] === choiceIndex ? ' is-selected' : ''}`}
                  key={`${choiceIndex}-${choice.slice(0, 24)}`}
                >
                  <input
                    type="radio"
                    name={`lesson-quiz-question-${questionIndex}`}
                    value={choiceIndex}
                    checked={answers[questionIndex] === choiceIndex}
                    onChange={() => handleSelectAnswer(choiceIndex)}
                  />
                  <span className="quiz-option-letter" aria-hidden="true">
                    {String.fromCharCode(65 + choiceIndex)}
                  </span>
                  <span>{choice}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="quiz-navigation">
            <button
              type="button"
              className="quiz-secondary-button"
              onClick={handlePrevious}
              disabled={questionIndex === 0}
            >
              <ArrowLeft size={17} aria-hidden="true" />
              Previous
            </button>
            <button
              type="button"
              className="quiz-primary-button"
              onClick={handleNext}
              disabled={answers[questionIndex] === null || answers[questionIndex] === undefined}
            >
              {questionIndex === quiz.questions.length - 1 ? 'See results' : 'Next'}
              <ArrowRight size={17} aria-hidden="true" />
            </button>
          </div>
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
