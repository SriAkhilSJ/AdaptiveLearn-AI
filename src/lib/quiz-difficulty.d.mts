export type QuestionDifficulty = 'easy' | 'medium' | 'hard'

export interface AdaptiveDifficultyState {
  target: QuestionDifficulty
  correctStreak: number
  incorrectStreak: number
  message: string
}

export declare const QUESTION_DIFFICULTIES: readonly ['easy', 'medium', 'hard']
export declare const INITIAL_ADAPTIVE_DIFFICULTY: Readonly<AdaptiveDifficultyState>

export declare function selectNextQuestionIndex(
  questions: ReadonlyArray<{ difficulty: QuestionDifficulty }>,
  usedQuestionIndices: ReadonlyArray<number>,
  target: QuestionDifficulty,
): number | null

export declare function updateAdaptiveDifficulty(
  state: AdaptiveDifficultyState,
  correct: boolean,
): AdaptiveDifficultyState
