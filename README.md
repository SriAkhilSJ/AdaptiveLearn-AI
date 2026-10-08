# AdaptiveLearn AI

**AI-Powered Personalized Learning for Students with Disabilities and Special Educational Needs**

Built for problem statement **PS-AI-02**: AI-assisted learning content that can
adapt text, audio, visuals, and learning methods to different student needs.

## Tech stack

- Vite + React + TypeScript
- lucide-react (icons)
- pdfjs-dist (client-side PDF text extraction)

## Work log

- **Work #1 — Base web app** ✅ — Project scaffolded; landing screen running,
  with a light/dark theme toggle (defaults to OS preference, choice persisted).
- **Work #2 — Student Accessibility Profile** ✅ — Multi-select support cards
  (easy-to-read text, audio, visual, step-by-step, larger text, repetition) +
  single-choice learning preference (text/audio/visual/mixed). Saved to
  localStorage. These are learning preferences only — the app never diagnoses.
- **Work #3 — Student Dashboard** ✅ — "Welcome back!" screen showing the
  saved learning preferences (with Edit), a Start a New Lesson section with
  Start Lesson + Upload Lesson buttons, and a Recent Lessons list (uploads
  are remembered locally). No AI yet.
- **Work #4 — PDF lesson upload** ✅ — Drag-and-drop or browse for a PDF;
  PDF.js extracts selectable text locally in the browser, shows the file name,
  size, page/word count, and an optional text preview. No AI generation.
- **Work #5 — Adaptive lessons** ⏭️ — Next: lessons that adapt text, audio,
  and visuals to the saved profile.

## Getting started

```bash
npm install
npm run dev
```

Then open the URL shown in the terminal (default: http://localhost:5173).

## Scripts

| Command           | Description                              |
| ----------------- | ---------------------------------------- |
| `npm run dev`     | Start the dev server                     |
| `npm run build`   | Type-check and build for production      |
| `npm run preview` | Preview the production build             |
| `npm run lint`    | Lint with oxlint                         |
