import test from 'node:test'
import assert from 'node:assert/strict'
import {
  INITIAL_ADAPTIVE_DIFFICULTY,
  selectNextQuestionIndex,
  updateAdaptiveDifficulty,
} from './quiz-difficulty.mjs'

const questions = [
  { difficulty: 'easy' },
  { difficulty: 'hard' },
  { difficulty: 'medium' },
  { difficulty: 'easy' },
  { difficulty: 'medium' },
]

test('starts at medium and chooses the closest unused question', () => {
  assert.equal(INITIAL_ADAPTIVE_DIFFICULTY.target, 'medium')
  assert.equal(selectNextQuestionIndex(questions, [], 'medium'), 2)
  assert.equal(selectNextQuestionIndex(questions, [2], 'medium'), 4)
  assert.equal(selectNextQuestionIndex(questions, [0, 2, 3, 4], 'hard'), 1)
  assert.equal(selectNextQuestionIndex([{ difficulty: 'easy' }, { difficulty: 'hard' }], [], 'medium'), 0)
  assert.equal(selectNextQuestionIndex(questions, [0, 1, 2, 3, 4], 'medium'), null)
})

test('raises the target one level after three correct first answers', () => {
  const oneCorrect = updateAdaptiveDifficulty(INITIAL_ADAPTIVE_DIFFICULTY, true)
  const twoCorrect = updateAdaptiveDifficulty(oneCorrect, true)
  const threeCorrect = updateAdaptiveDifficulty(twoCorrect, true)
  assert.equal(twoCorrect.correctStreak, 2)
  assert.equal(threeCorrect.target, 'hard')
  assert.equal(threeCorrect.correctStreak, 0)
  assert.match(threeCorrect.message, /three correct first answers/i)
})

test('lowers the target one level after two incorrect first answers', () => {
  const oneIncorrect = updateAdaptiveDifficulty(INITIAL_ADAPTIVE_DIFFICULTY, false)
  const twoIncorrect = updateAdaptiveDifficulty(oneIncorrect, false)
  assert.equal(twoIncorrect.target, 'easy')
  assert.equal(twoIncorrect.incorrectStreak, 0)
  assert.match(twoIncorrect.message, /two incorrect first answers/i)
})

test('an opposite first-answer result breaks the consecutive streak', () => {
  const afterTwoCorrect = updateAdaptiveDifficulty(
    updateAdaptiveDifficulty(INITIAL_ADAPTIVE_DIFFICULTY, true),
    true,
  )
  const afterIncorrect = updateAdaptiveDifficulty(afterTwoCorrect, false)
  assert.equal(afterIncorrect.target, 'medium')
  assert.equal(afterIncorrect.correctStreak, 0)
  assert.equal(afterIncorrect.incorrectStreak, 1)
})

test('difficulty stays within easy and hard bounds', () => {
  const hard = { ...INITIAL_ADAPTIVE_DIFFICULTY, target: 'hard' }
  const afterHardStreak = updateAdaptiveDifficulty(
    updateAdaptiveDifficulty(updateAdaptiveDifficulty(hard, true), true),
    true,
  )
  const easy = { ...INITIAL_ADAPTIVE_DIFFICULTY, target: 'easy' }
  const afterEasyStreak = updateAdaptiveDifficulty(
    updateAdaptiveDifficulty(easy, false),
    false,
  )
  assert.equal(afterHardStreak.target, 'hard')
  assert.equal(afterEasyStreak.target, 'easy')
})
