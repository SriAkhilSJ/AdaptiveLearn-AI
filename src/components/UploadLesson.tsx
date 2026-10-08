import { useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileText,
  LoaderCircle,
  Trash2,
  UploadCloud,
} from 'lucide-react'
import { addRecentLesson } from '../lib/lessons'
import type { UploadedLesson } from '../lib/adaptive'
import {
  extractPdfText,
  PdfExtractionError,
  type ExtractedPdfText,
} from '../lib/pdf'
import './UploadLesson.css'

const MAX_FILE_SIZE = 25 * 1024 * 1024
const PREVIEW_LIMIT = 5000

type UploadStatus = 'ready' | 'extracting' | 'success'

interface UploadLessonProps {
  onBack: () => void
  onContinue: (lesson: UploadedLesson) => void
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function wordCount(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

export function UploadLesson({ onBack, onContinue }: UploadLessonProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState<UploadStatus>('ready')
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [extracted, setExtracted] = useState<ExtractedPdfText | null>(null)

  const chooseFile = (nextFile: File | undefined) => {
    if (!nextFile) return

    setError(null)
    setExtracted(null)
    setStatus('ready')

    const isPdf =
      nextFile.type === 'application/pdf' || nextFile.name.toLowerCase().endsWith('.pdf')
    if (!isPdf) {
      setFile(null)
      setError('Please choose a PDF file.')
      return
    }
    if (nextFile.size === 0) {
      setFile(null)
      setError('This file is empty. Please choose another PDF.')
      return
    }
    if (nextFile.size > MAX_FILE_SIZE) {
      setFile(null)
      setError('This PDF is larger than 25 MB. Please choose a smaller file.')
      return
    }

    setFile(nextFile)
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    chooseFile(event.target.files?.[0])
    // Allow the same PDF to be chosen again after removing or correcting it.
    event.target.value = ''
  }

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    dragDepth.current += 1
    setIsDragging(true)
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
  }

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    dragDepth.current -= 1
    if (dragDepth.current <= 0) {
      dragDepth.current = 0
      setIsDragging(false)
    }
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    dragDepth.current = 0
    setIsDragging(false)
    chooseFile(event.dataTransfer.files[0])
  }

  const handleRemoveFile = () => {
    setFile(null)
    setExtracted(null)
    setError(null)
    setStatus('ready')
  }

  const handleContinue = async () => {
    if (status === 'success' && file && extracted) {
      onContinue({
        name: file.name,
        size: file.size,
        pageCount: extracted.pageCount,
        text: extracted.text,
      })
      return
    }
    if (!file || status === 'extracting') return

    setStatus('extracting')
    setError(null)
    try {
      const result = await extractPdfText(file)
      setExtracted(result)
      setStatus('success')
      addRecentLesson(file.name)
    } catch (cause) {
      setStatus('ready')
      setError(
        cause instanceof PdfExtractionError
          ? cause.message
          : 'We could not read this PDF. Please choose another file and try again.',
      )
    }
  }

  const previewText = extracted?.text.slice(0, PREVIEW_LIMIT) ?? ''
  const hasMoreText = (extracted?.text.length ?? 0) > PREVIEW_LIMIT

  return (
    <main className="upload-screen">
      <div className="upload-card">
        <button type="button" className="back-button" onClick={onBack}>
          <ArrowLeft size={18} aria-hidden="true" />
          Back to dashboard
        </button>

        <div className="upload-heading-icon" aria-hidden="true">
          <UploadCloud size={32} strokeWidth={1.75} />
        </div>
        <h1 className="title">Upload a Lesson</h1>
        <p className="subtitle">
          Choose a PDF lesson and we will extract its text for you.
        </p>

        <section
          className={`drop-zone${isDragging ? ' is-dragging' : ''}`}
          aria-labelledby="drop-zone-title"
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <FileText className="drop-zone-file-icon" size={34} aria-hidden="true" />
          <h2 id="drop-zone-title">Drag and drop your PDF here</h2>
          <p className="drop-zone-or">or</p>
          <button
            type="button"
            className="secondary-button browse-button"
            onClick={() => fileInputRef.current?.click()}
          >
            <UploadCloud size={17} aria-hidden="true" />
            Browse file
          </button>
          <p className="drop-zone-help" id="upload-help">
            PDF only · Maximum file size 25 MB
          </p>
        </section>

        <input
          ref={fileInputRef}
          className="visually-hidden"
          type="file"
          accept="application/pdf,.pdf"
          aria-hidden="true"
          tabIndex={-1}
          onChange={handleFileChange}
        />

        {file && (
          <section className="selected-file" aria-label="Selected PDF lesson">
            <span className="selected-file-icon" aria-hidden="true">
              <FileText size={22} />
            </span>
            <span className="selected-file-info">
              <span className="selected-file-name">{file.name}</span>
              <span className="selected-file-size">{formatFileSize(file.size)}</span>
            </span>
            {status !== 'extracting' && status !== 'success' && (
              <button
                type="button"
                className="remove-file-button"
                aria-label={`Remove ${file.name}`}
                onClick={handleRemoveFile}
              >
                <Trash2 size={18} aria-hidden="true" />
              </button>
            )}
          </section>
        )}

        {error && (
          <p className="upload-message error-message" role="alert">
            <AlertCircle size={19} aria-hidden="true" />
            <span>{error}</span>
          </p>
        )}

        {status === 'success' && extracted && (
          <section className="extraction-result" aria-labelledby="upload-success-title">
            <p className="upload-message success-message" role="status">
              <CheckCircle2 size={20} aria-hidden="true" />
              <span id="upload-success-title">Lesson uploaded successfully.</span>
            </p>
            <p className="extraction-summary">
              {extracted.pageCount} {extracted.pageCount === 1 ? 'page' : 'pages'}
              {' · '}
              {wordCount(extracted.text).toLocaleString()} words extracted
            </p>
            <details className="extracted-preview">
              <summary>Preview extracted text</summary>
              <pre>
                {previewText}
                {hasMoreText ? '\n\n… Preview shortened. The full text was extracted.' : ''}
              </pre>
            </details>
          </section>
        )}

        <div className="upload-actions">
          <button
            type="button"
            className="start-button"
            disabled={!file || status === 'extracting'}
            aria-busy={status === 'extracting'}
            onClick={handleContinue}
          >
            {status === 'extracting' ? (
              <>
                <LoaderCircle className="loading-icon" size={19} aria-hidden="true" />
                Extracting text…
              </>
            ) : (
              <>
                Continue
                <ArrowRight size={19} aria-hidden="true" />
              </>
            )}
          </button>
          {status === 'success' && (
            <p className="continue-hint">Continue to personalize this lesson.</p>
          )}
        </div>
      </div>
    </main>
  )
}
