import { useEffect, useId, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Image as ImageIcon,
  ListOrdered,
  LoaderCircle,
  Sparkles,
} from 'lucide-react'
import type { UploadedLesson } from '../lib/adaptive'
import {
  getComicImageStatus,
  requestComicPanelImage,
  requestComicStoryboard,
  toPanelDataUrl,
  type ComicImageStatus,
  type ComicPanel,
  type ComicStoryboard,
} from '../lib/comic'
import './ComicLesson.css'

interface ComicLessonProps {
  lesson: UploadedLesson
  explanationStyle: string
  largeText: boolean
}

type StoryboardStatus = 'idle' | 'loading' | 'ready' | 'error'

interface PanelImageState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  dataUrl?: string
  error?: string
}

function PanelFigure({
  panel,
  total,
  image,
  canGenerateImage,
  imageStatusPending,
  onGenerateImage,
  focusableHeading,
  headingRef,
}: {
  panel: ComicPanel
  total: number
  image: PanelImageState | undefined
  canGenerateImage: boolean
  imageStatusPending: boolean
  onGenerateImage: (panel: ComicPanel) => void
  focusableHeading: boolean
  headingRef?: React.RefObject<HTMLHeadingElement | null>
}) {
  const headingId = useId()
  const imageState = image?.status ?? 'idle'

  return (
    <figure className="comic-panel" aria-labelledby={headingId}>
      <figcaption className="comic-panel-text">
        <h4
          id={headingId}
          className="comic-panel-heading"
          ref={headingRef}
          tabIndex={focusableHeading ? -1 : undefined}
        >
          Panel {panel.order} of {total}
        </h4>
        <p className="comic-caption">{panel.caption}</p>
        {panel.dialogue && (
          <p className="comic-dialogue">
            <span className="comic-label">Says: </span>
            <q>{panel.dialogue}</q>
          </p>
        )}
        <p className="comic-takeaway">
          <span className="comic-label">Key idea: </span>
          {panel.takeaway}
        </p>
      </figcaption>

      {imageState === 'ready' && image?.dataUrl && (
        <img src={image.dataUrl} alt={panel.altText} className="comic-art" />
      )}
      {imageState === 'loading' && (
        <p className="comic-image-status" role="status" aria-busy="true">
          <LoaderCircle className="comic-spinner" size={18} aria-hidden="true" />
          Creating the illustration for panel {panel.order}…
        </p>
      )}
      {imageState === 'error' && (
        <p className="comic-image-error" role="alert">
          <AlertCircle size={18} aria-hidden="true" />
          <span>{image?.error || 'The illustration could not be created.'}</span>
        </p>
      )}

      <div className="comic-panel-actions">
        {imageStatusPending && imageState === 'idle' && (
          <p className="comic-image-status" role="status">
            Checking illustration setup…
          </p>
        )}
        {canGenerateImage && (imageState === 'idle' || imageState === 'error') && (
          <button
            type="button"
            className="comic-generate-button"
            onClick={() => onGenerateImage(panel)}
          >
            <ImageIcon size={18} aria-hidden="true" />
            {imageState === 'error'
              ? `Try panel ${panel.order} illustration again`
              : `Generate illustration for panel ${panel.order}`}
          </button>
        )}
      </div>

      <details className="comic-scene">
        <summary>Illustration description</summary>
        <p>{panel.scene}</p>
      </details>
    </figure>
  )
}

export function ComicLesson({ lesson, explanationStyle, largeText }: ComicLessonProps) {
  const [storyboardStatus, setStoryboardStatus] = useState<StoryboardStatus>('idle')
  const [storyboard, setStoryboard] = useState<ComicStoryboard | null>(null)
  const [storyboardError, setStoryboardError] = useState<string | null>(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [showAll, setShowAll] = useState(false)
  const [panelImages, setPanelImages] = useState<Record<string, PanelImageState>>({})
  const [imageStatus, setImageStatus] = useState<ComicImageStatus | null>(null)
  const [imageStatusState, setImageStatusState] = useState<'pending' | 'ready' | 'failed'>('pending')
  const panelHeadingRef = useRef<HTMLHeadingElement | null>(null)

  // Check illustration setup once the text storyboard exists. This status
  // check never generates images or makes paid provider calls.
  useEffect(() => {
    if (storyboardStatus !== 'ready') return
    let cancelled = false
    getComicImageStatus()
      .then((status) => {
        if (cancelled) return
        setImageStatus(status)
        setImageStatusState('ready')
      })
      .catch(() => {
        if (cancelled) return
        setImageStatus(null)
        setImageStatusState('failed')
      })
    return () => {
      cancelled = true
    }
  }, [storyboardStatus])

  const handleCreateStoryboard = async () => {
    setStoryboardStatus('loading')
    setStoryboardError(null)
    setImageStatus(null)
    setImageStatusState('pending')
    try {
      const result = await requestComicStoryboard(lesson, explanationStyle)
      setStoryboard(result)
      setCurrentIndex(0)
      setShowAll(false)
      setPanelImages({})
      setStoryboardStatus('ready')
    } catch (cause) {
      setStoryboardError(
        cause instanceof Error ? cause.message : 'The comic storyboard could not be created.',
      )
      setStoryboardStatus('error')
    }
  }

  const goToPanel = (nextIndex: number) => {
    if (!storyboard) return
    const clamped = Math.min(Math.max(nextIndex, 0), storyboard.panels.length - 1)
    setCurrentIndex(clamped)
    // The heading element persists across panels, so focusing it announces
    // the newly selected panel to screen-reader users on their request.
    panelHeadingRef.current?.focus()
  }

  const handleGenerateImage = async (panel: ComicPanel) => {
    setPanelImages((current) => ({ ...current, [panel.id]: { status: 'loading' } }))
    try {
      const image = await requestComicPanelImage(panel, storyboard?.title ?? '')
      setPanelImages((current) => ({
        ...current,
        [panel.id]: { status: 'ready', dataUrl: toPanelDataUrl(image) },
      }))
    } catch (cause) {
      setPanelImages((current) => ({
        ...current,
        [panel.id]: {
          status: 'error',
          error: cause instanceof Error ? cause.message : 'The illustration could not be created.',
        },
      }))
    }
  }

  const illustrationsAvailable = imageStatusState === 'ready' && imageStatus?.configured === true
  // If the setup check itself failed, still offer generation: the server
  // gives the definitive answer per request.
  const canOfferGeneration = illustrationsAvailable || imageStatusState === 'failed'
  const showUnconfiguredNotice = imageStatusState === 'ready' && imageStatus?.configured === false

  return (
    <section
      className={`comic-lesson${largeText ? ' comic-lesson-large' : ''}`}
      aria-labelledby="comic-lesson-heading"
    >
      <div className="comic-intro">
        <h4 id="comic-lesson-heading" className="comic-title">
          Comic version
        </h4>
        <p className="comic-description">
          Work through the lesson as a short comic. You control every step: create the story, then
          move between panels when you are ready. Nothing advances on its own.
        </p>
      </div>

      {storyboardStatus !== 'ready' && (
        <div className="comic-start">
          {storyboardStatus === 'loading' ? (
            <p className="comic-loading" role="status" aria-busy="true">
              <LoaderCircle className="comic-spinner" size={20} aria-hidden="true" />
              Creating your comic from the lesson…
            </p>
          ) : (
            <button
              type="button"
              className="comic-primary-button"
              onClick={handleCreateStoryboard}
            >
              <Sparkles size={18} aria-hidden="true" />
              Create comic storyboard
            </button>
          )}
          {storyboardStatus === 'error' && storyboardError && (
            <p className="comic-error" role="alert">
              <AlertCircle size={19} aria-hidden="true" />
              <span>{storyboardError}</span>
            </p>
          )}
          <p className="comic-privacy-note">
            The lesson text is sent to your configured AI provider to create the storyboard. A panel
            illustration is generated only when you request it.
          </p>
        </div>
      )}

      {storyboardStatus === 'ready' && storyboard && (
        <div className="comic-story">
          <div className="comic-story-header">
            <h5 className="comic-story-title">{storyboard.title}</h5>
            <p className="comic-progress" role="status">
              Panel {currentIndex + 1} of {storyboard.panels.length}
            </p>
          </div>

          {showUnconfiguredNotice && (
            <p className="comic-notice" role="note">
              Illustration generation is not configured, so this comic is text only for now. The
              captions, dialogue, and key ideas below cover the full lesson.
              {imageStatus?.missing?.length ? (
                <> Your administrator can set: {imageStatus.missing.join(', ')}.</>
              ) : (
                <> Your administrator can enable an image provider in the server setup.</>
              )}
            </p>
          )}

          {!showAll && (
            <PanelFigure
              panel={storyboard.panels[currentIndex]}
              total={storyboard.panels.length}
              image={panelImages[storyboard.panels[currentIndex].id]}
              canGenerateImage={canOfferGeneration}
              imageStatusPending={imageStatusState === 'pending'}
              onGenerateImage={handleGenerateImage}
              focusableHeading
              headingRef={panelHeadingRef}
            />
          )}

          <div className="comic-navigation" role="group" aria-label="Comic panel navigation">
            <button
              type="button"
              className="comic-nav-button"
              onClick={() => goToPanel(currentIndex - 1)}
              disabled={showAll || currentIndex === 0}
            >
              <ArrowLeft size={17} aria-hidden="true" />
              Previous panel
            </button>
            <button
              type="button"
              className="comic-nav-button"
              onClick={() => goToPanel(currentIndex + 1)}
              disabled={showAll || currentIndex === storyboard.panels.length - 1}
            >
              Next panel
              <ArrowRight size={17} aria-hidden="true" />
            </button>
          </div>

          <button
            type="button"
            className="comic-toggle-button"
            aria-expanded={showAll}
            onClick={() => setShowAll((value) => !value)}
          >
            {showAll ? (
              <BookOpen size={17} aria-hidden="true" />
            ) : (
              <ListOrdered size={17} aria-hidden="true" />
            )}
            {showAll ? 'Show one panel at a time' : 'Show all panels'}
          </button>

          {showAll && (
            <ol className="comic-all-panels" aria-label="All comic panels in order">
              {storyboard.panels.map((panel) => (
                <li key={panel.id}>
                  <PanelFigure
                    panel={panel}
                    total={storyboard.panels.length}
                    image={panelImages[panel.id]}
                    canGenerateImage={canOfferGeneration}
                    imageStatusPending={imageStatusState === 'pending'}
                    onGenerateImage={handleGenerateImage}
                    focusableHeading={false}
                  />
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  )
}
