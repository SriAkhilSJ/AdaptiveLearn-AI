import { RequestValidationError } from './adaptation-service.mjs'
import { MAX_IMAGE_PROMPT_CHARS } from '../providers/image-provider.mjs'
import { MAX_PANEL_SCENE_CHARS } from './comic-storyboard-service.mjs'

const MAX_PANEL_TITLE_CHARS = 80

/**
 * Build a bounded, learner-safe illustration prompt from one validated panel.
 * Words stay outside the artwork as HTML, so the prompt bans rendered text;
 * characters must be original so a requested franchise never leaks into art.
 */
export function buildPanelImagePrompt({ title = '', scene }) {
  const cleanScene = scene.trim().replace(/\s+/g, ' ')
  const cleanTitle = title.trim().replace(/\s+/g, ' ').slice(0, MAX_PANEL_TITLE_CHARS)
  const prompt = [
    'Warm, friendly comic-book panel illustration for students, original characters and setting only.',
    'Do not depict copyrighted characters, real people, logos, brands, or franchise art styles.',
    'Important: no words, letters, numbers, captions, speech bubbles, signs with text, logos, or watermarks anywhere in the image.',
    cleanTitle ? `Story: ${cleanTitle}.` : '',
    `Scene: ${cleanScene}.`,
  ].filter(Boolean).join(' ')
  return prompt.slice(0, MAX_IMAGE_PROMPT_CHARS)
}

function normalizePanelRequest(input) {
  const panel = input?.panel
  if (typeof panel !== 'object' || panel === null) {
    throw new RequestValidationError('A comic panel is required to generate its illustration.')
  }
  if (typeof panel.id !== 'string' || !/^panel-[1-5]$/.test(panel.id)) {
    throw new RequestValidationError('The comic panel id is invalid.')
  }
  if (typeof panel.scene !== 'string' || !panel.scene.trim()) {
    throw new RequestValidationError('The comic panel has no scene to illustrate.')
  }
  if (panel.scene.length > MAX_PANEL_SCENE_CHARS * 2) {
    throw new RequestValidationError('The comic panel scene is too long to illustrate.', 413)
  }
  const title = typeof input.title === 'string' ? input.title.trim().slice(0, MAX_PANEL_TITLE_CHARS) : ''
  return { panelId: panel.id, title, scene: panel.scene.trim().replace(/\s+/g, ' ').slice(0, MAX_PANEL_SCENE_CHARS) }
}

/**
 * Generate one panel illustration at a time through the configured image
 * provider. Only the panel scene (plus an optional short title) is sent to
 * the image service — never the full lesson text.
 */
export function createComicImageService(imageProvider) {
  if (!imageProvider || typeof imageProvider.generate !== 'function') {
    throw new TypeError('An image provider implementing generate({ prompt }) is required.')
  }

  return {
    async generatePanelImage(input) {
      const normalized = normalizePanelRequest(input)
      const prompt = buildPanelImagePrompt(normalized)
      let result
      try {
        result = await imageProvider.generate({ prompt })
      } catch (cause) {
        if (cause?.statusCode) throw cause
        throw new Error('The illustration request failed.')
      }
      return {
        panelId: normalized.panelId,
        mimeType: result.mimeType,
        base64: result.base64,
      }
    },
  }
}
