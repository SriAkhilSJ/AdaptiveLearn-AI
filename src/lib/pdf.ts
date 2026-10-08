import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

export interface ExtractedPdfText {
  text: string
  pageCount: number
}

export type PdfExtractionErrorCode = 'password' | 'invalid' | 'no-text' | 'read'

export class PdfExtractionError extends Error {
  readonly code: PdfExtractionErrorCode

  constructor(code: PdfExtractionErrorCode) {
    const messages: Record<PdfExtractionErrorCode, string> = {
      password: 'This PDF is password protected. Please choose an unlocked PDF.',
      invalid: 'This PDF could not be opened. Please check the file and try again.',
      'no-text':
        'No selectable text was found. This may be a scanned PDF; please choose a text-based PDF.',
      read: 'We could not extract text from this PDF. Please try another file.',
    }
    super(messages[code])
    this.name = 'PdfExtractionError'
    this.code = code
  }
}

function getErrorName(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('name' in error)) {
    return undefined
  }
  return typeof error.name === 'string' ? error.name : undefined
}

/** Extract selectable text from every page of a PDF in the browser. */
export async function extractPdfText(file: File): Promise<ExtractedPdfText> {
  let cleanup: () => Promise<void> = async () => {}

  try {
    // Lazy-load PDF.js so the library is not part of the app's initial bundle.
    const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist')
    GlobalWorkerOptions.workerSrc = pdfWorkerUrl

    const bytes = new Uint8Array(await file.arrayBuffer())
    const loadingTask = getDocument({ data: bytes })
    cleanup = () => loadingTask.destroy()

    const pdf = await loadingTask.promise

    const pageTexts: string[] = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      const parts: string[] = []

      for (const item of content.items) {
        if ('str' in item && item.str) {
          parts.push(item.str)
          parts.push(item.hasEOL ? '\n' : ' ')
        }
      }

      const pageText = parts
        .join('')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
      if (pageText) pageTexts.push(pageText)
    }

    const text = pageTexts.join('\n\n').trim()
    if (!text) throw new PdfExtractionError('no-text')

    return { text, pageCount: pdf.numPages }
  } catch (error) {
    if (error instanceof PdfExtractionError) throw error

    const name = getErrorName(error)
    if (name === 'PasswordException') throw new PdfExtractionError('password')
    if (name === 'InvalidPDFException' || name === 'FormatError') {
      throw new PdfExtractionError('invalid')
    }
    throw new PdfExtractionError('read')
  } finally {
    await cleanup().catch(() => undefined)
  }
}
