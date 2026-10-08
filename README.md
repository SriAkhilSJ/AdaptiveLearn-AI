# AdaptiveLearn AI

**AI-Powered Personalized Learning for Students with Disabilities and Special Educational Needs**

Built for problem statement **PS-AI-02**: AI-assisted learning content that can
adapt text, audio, visuals, and learning methods to different student needs.

## Tech stack

- Vite + React + TypeScript
- Node.js API/service layer
- OpenAI-compatible provider adapter (server-side)
- PDF.js for local PDF text extraction
- lucide-react for icons

## Work log

- **Work #1 — Base web app** ✅ — Landing screen and light/dark theme toggle.
- **Work #2 — Student Accessibility Profile** ✅ — Multi-select learning
  supports and a text/audio/visual/mixed preference, saved locally. These are
  learning preferences only — the app does not diagnose.
- **Work #3 — Student Dashboard** ✅ — Shows saved preferences and recent lessons.
- **Work #4 — PDF lesson upload** ✅ — Drag-and-drop or browse for a PDF;
  PDF.js extracts selectable text locally in the browser.
- **Work #5 — Adaptive Learning Engine** ✅ — Sends the extracted lesson and
  saved preferences to a server-side AI provider and displays standard,
  easy-to-read, step-by-step, visual, audio-ready, and personalized lesson
  versions. The Personalized Learning screen switches between four formats
  and uses the browser Web Speech API to read the lesson aloud. The API key is
  read only by the Node server; no key is included in the browser bundle.
- **Work #6 — Lesson Quiz** ✅ — Creates five multiple-choice questions from
  the uploaded lesson, presents one question at a time with four choices and
  progress, then reports the score and concepts to review.

## Getting started

For the full first-time setup, see [Setup.md](Setup.md).

```bash
npm install
cp .env.example .env
```

Set `AI_API_KEY` in your local `.env` file, then run:

```bash
npm run dev
```

The dev command starts both the Vite app and the Node API. Open the URL shown
by Vite (default: http://localhost:5173). If no key is configured, the app
still starts and explains how to configure the AI service when adaptation or
quiz generation is requested. **Never use a `VITE_` prefix for secret keys and
never commit `.env`.**

PDF text and selected learning preferences are sent to the configured AI
provider only when the student chooses **Generate adaptations**. The lesson
text is also sent to the provider only when the student chooses **Create quiz**.
Scanned PDFs without selectable text are not OCR'd.

## Changing the AI provider

The browser calls the same-origin `/api/adapt` endpoint. Provider details live
behind the `generate({ messages })` adapter interface in `server/providers/`.
The current adapter accepts an OpenAI-compatible Chat Completions endpoint;
set `AI_PROVIDER`, `AI_BASE_URL`, `AI_MODEL`, and `AI_API_KEY` in the server
environment. To add a provider with a different protocol, implement the same
adapter interface and register it in `server/providers/index.mjs`.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite app and Node API together |
| `npm run build` | Type-check and build the client |
| `npm start` | Serve the built client and API |
| `npm run test` | Run provider and adaptation-service tests |
| `npm run lint` | Lint with oxlint |
