import type { UploadedLesson } from './adaptive'

export interface ComicPanel {
  id: string
  order: number
  caption: string
  dialogue: string
  altText: string
  scene: string
  takeaway: string
}

export interface ComicStoryboard {
  title: string
  panels: ComicPanel[]
}

export interface ComicPanelImage {
  panelId: string
  mimeType: string
  /** Base64-encoded bytes only (no data-URL prefix). */
  base64: string
}

export interface ComicImageStatus {
  configured: boolean
  provider: string
  /** Missing server-side variable names only — never values. */
  missing: string[]
}

interface StoryboardApiResponse {
  storyboard?: ComicStoryboard
  error?: string
}

interface PanelImageApiResponse {
  image?: ComicPanelImage
  error?: string
}

const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const MAX_CLIENT_IMAGE_BASE64_CHARS = 7_000_000

function isValidStoryboard(value: unknown): value is ComicStoryboard {
  if (typeof value !== 'object' || value === null) return false
  const storyboard = value as ComicStoryboard
  if (typeof storyboard.title !== 'string' || !storyboard.title.trim()) return false
  if (!Array.isArray(storyboard.panels)) return false
  if (storyboard.panels.length < 3 || storyboard.panels.length > 5) return false
  return storyboard.panels.every(
    (panel) =>
      typeof panel === 'object' &&
      panel !== null &&
      typeof panel.id === 'string' &&
      typeof panel.caption === 'string' &&
      panel.caption.trim() &&
      typeof panel.altText === 'string' &&
      panel.altText.trim() &&
      typeof panel.scene === 'string' &&
      panel.scene.trim() &&
      typeof panel.takeaway === 'string' &&
      panel.takeaway.trim(),
  )
}

/** Create a 3–5 panel storyboard from the uploaded lesson. Called only on explicit learner action. */
export async function requestComicStoryboard(
  lesson: UploadedLesson,
  explanationStyle = '',
): Promise<ComicStoryboard> {
  let response: Response
  try {
    response = await fetch('/api/comic/storyboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lesson: { title: lesson.name, text: lesson.text },
        explanationStyle,
      }),
    })
  } catch {
    throw new Error(
      'The comic service could not be reached. Check that the app server is running and try again.',
    )
  }

  let payload: StoryboardApiResponse = {}
  try {
    payload = (await response.json()) as StoryboardApiResponse
  } catch {
    // The response may be empty when the service is restarting.
  }

  if (!response.ok) {
    throw new Error(payload.error || 'The comic storyboard could not be created. Please try again.')
  }
  if (!isValidStoryboard(payload.storyboard)) {
    throw new Error('The AI service returned an incomplete comic storyboard. Please try again.')
  }
  return payload.storyboard
}

/** Check whether panel illustration generation is configured. Reports names only. */
export async function getComicImageStatus(): Promise<ComicImageStatus> {
  const response = await fetch('/api/comic/image-status', { method: 'GET' })
  let payload: Partial<ComicImageStatus> = {}
  try {
    payload = (await response.json()) as Partial<ComicImageStatus>
  } catch {
    // Fall through to the invalid-status error below.
  }
  if (
    !response.ok ||
    typeof payload.configured !== 'boolean' ||
    typeof payload.provider !== 'string' ||
    !Array.isArray(payload.missing)
  ) {
    throw new Error('The illustration setup could not be checked. Please try again.')
  }
  return {
    configured: payload.configured,
    provider: payload.provider,
    missing: payload.missing.filter((name): name is string => typeof name === 'string'),
  }
}

/** Generate one panel illustration. Called only when the learner requests that panel's art. */
export async function requestComicPanelImage(
  panel: Pick<ComicPanel, 'id' | 'scene'>,
  title = '',
): Promise<ComicPanelImage> {
  let response: Response
  try {
    response = await fetch('/api/comic/panel-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ panel: { id: panel.id, scene: panel.scene }, title }),
    })
  } catch {
    throw new Error(
      'The illustration service could not be reached. Check that the app server is running and try again.',
    )
  }

  let payload: PanelImageApiResponse = {}
  try {
    payload = (await response.json()) as PanelImageApiResponse
  } catch {
    // The response may be empty when the service is restarting.
  }

  if (!response.ok) {
    throw new Error(payload.error || 'The panel illustration could not be created. Please try again.')
  }
  const image = payload.image
  if (
    !image ||
    image.panelId !== panel.id ||
    !ALLOWED_IMAGE_MIME_TYPES.has(image.mimeType) ||
    typeof image.base64 !== 'string' ||
    !image.base64.trim() ||
    image.base64.length > MAX_CLIENT_IMAGE_BASE64_CHARS
  ) {
    throw new Error('The illustration service returned an invalid image. Please try again.')
  }
  return image
}

/** Build a same-session data URL for a validated panel image. Nothing is persisted. */
export function toPanelDataUrl(image: ComicPanelImage): string {
  return `data:${image.mimeType};base64,${image.base64}`
}
