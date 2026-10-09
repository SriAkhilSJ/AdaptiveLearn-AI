export const QUESTION_DIFFICULTIES = Object.freeze(['easy', 'medium', 'hard'])

export const INITIAL_ADAPTIVE_DIFFICULTY = Object.freeze({
  target: 'medium',
  correctStreak: 0,
  incorrectStreak: 0,
  message: 'The quiz starts at Medium. Three correct first answers in a row raise the target; two incorrect first answers in a row lower it.',
})

const difficultyRank = {
  easy: 0,
  medium: 1,
  hard: 2,
}

/** Return the unused question closest to the target; provider order breaks ties. */
export function selectNextQuestionIndex(questions, usedQuestionIndices, target) {
  const used = new Set(usedQuestionIndices)
  let bestIndex = null
  let bestDistance = Number.POSITIVE_INFINITY

  questions.forEach((question, index) => {
    if (used.has(index)) return
    const distance = Math.abs(difficultyRank[question.difficulty] - difficultyRank[target])
    if (distance < bestDistance) {
      bestIndex = index
      bestDistance = distance
    }
  })

  return bestIndex
}

/** Update the next-question target from a first-answer result only. */
export function updateAdaptiveDifficulty(state, correct) {
  if (correct) {
    const correctStreak = state.correctStreak + 1
    if (correctStreak < 3) {
      const remaining = 3 - correctStreak
      return {
        ...state,
        correctStreak,
        incorrectStreak: 0,
        message: state.target === 'hard'
          ? `${correctStreak} correct first ${correctStreak === 1 ? 'answer' : 'answers'} in a row. The target is already Hard, the highest level.`
          : `${correctStreak} correct first ${correctStreak === 1 ? 'answer' : 'answers'} in a row. ${remaining} more consecutive correct ${remaining === 1 ? 'answer' : 'answers'} will raise the next-question target.`,
      }
    }

    const targetIndex = Math.min(difficultyRank.hard, difficultyRank[state.target] + 1)
    const target = targetIndex === difficultyRank.hard ? 'hard' : 'medium'
    return {
      target,
      correctStreak: 0,
      incorrectStreak: 0,
      message: target === state.target
        ? 'Three correct first answers in a row. The target stays at Hard, the highest level.'
        : `Three correct first answers in a row. The next-question target is now ${capitalize(target)}.`,
    }
  }

  const incorrectStreak = state.incorrectStreak + 1
  if (incorrectStreak < 2) {
    return {
      ...state,
      correctStreak: 0,
      incorrectStreak,
      message: state.target === 'easy'
        ? 'One incorrect first answer in a row. The target is already Easy, the gentlest level.'
        : 'One incorrect first answer in a row. One more consecutive incorrect first answer will lower the next-question target.',
    }
  }

  const targetIndex = Math.max(difficultyRank.easy, difficultyRank[state.target] - 1)
  const target = targetIndex === difficultyRank.easy ? 'easy' : 'medium'
  return {
    target,
    correctStreak: 0,
    incorrectStreak: 0,
    message: target === state.target
      ? 'Two incorrect first answers in a row. The target stays at Easy, the gentlest level.'
      : `Two incorrect first answers in a row. The next-question target is now ${capitalize(target)}.`,
  }
}

function capitalize(value) {
  return value[0].toUpperCase() + value.slice(1)
}
