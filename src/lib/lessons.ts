/**
 * Recent Lessons — a small local list of lessons on this device.
 * No AI, no backend: we only remember lesson names so the dashboard
 * can show what the student has been working with.
 */

export interface RecentLesson {
  id: string
  name: string
  /** ISO 8601 timestamp of when the lesson was added. */
  uploadedAt: string
}

const STORAGE_KEY = 'adaptivelearn-recent-lessons'
const MAX_RECENT_LESSONS = 5

/** Load recent lessons (newest first). Empty list if none/invalid. */
export function loadRecentLessons(): RecentLesson[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (item): item is RecentLesson =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as RecentLesson).id === 'string' &&
          typeof (item as RecentLesson).name === 'string' &&
          typeof (item as RecentLesson).uploadedAt === 'string',
      )
      .slice(0, MAX_RECENT_LESSONS)
  } catch {
    return []
  }
}

/**
 * Add a lesson to the top of the recent list (de-duplicated by name,
 * capped at MAX_RECENT_LESSONS), save it, and return the new list.
 */
export function addRecentLesson(name: string): RecentLesson[] {
  const lesson: RecentLesson = {
    id: crypto.randomUUID(),
    name,
    uploadedAt: new Date().toISOString(),
  }
  const next = [
    lesson,
    ...loadRecentLessons().filter((l) => l.name !== name),
  ].slice(0, MAX_RECENT_LESSONS)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Storage unavailable — the in-memory list still updates this session.
  }
  return next
}
