# AdaptiveLearn AI

**AI-assisted lessons shaped around each learner’s preferences**

Built for problem statement **PS-AI-02**: AI-assisted learning content that can
adapt text, audio, visuals, and learning methods to different student needs.

## Tech stack

- Vite + React + TypeScript
- Tailwind CSS utilities alongside accessible CSS design tokens
- Node.js API/service layer
- OpenAI-compatible provider adapter (server-side)
- PDF.js for local PDF text extraction
- LiveKit Agents for real-time audio sessions and lesson-grounded tutor dispatch
- Deepgram streaming speech recognition and voice synthesis; the existing OpenAI-compatible model powers the spoken tutor
- lucide-react for icons

## Work log

- **Work #1 — Base web app** ✅ — Landing screen and light/dark theme toggle.
- **Work #2 — Student Accessibility Profile** ✅ — Multi-select learning
  supports, a text/audio/visual/mixed preference, and an optional free-form
  “Explain it like…” storytelling/personification style, saved locally. These
  are learning preferences only — the app does not diagnose.
- **Work #3 — Student Dashboard** ✅ — Shows saved preferences and recent lessons.
- **Work #4 — PDF lesson upload** ✅ — Drag-and-drop or browse for a PDF;
  PDF.js extracts selectable text locally in the browser.
- **Work #5 — Adaptive Learning Engine** ✅ — Sends the extracted lesson and
  saved preferences to a server-side AI provider and displays standard,
  easy-to-read, step-by-step, visual, audio-ready, and personalized lesson
  versions. The visual view is a compact whole-lesson diagram: it summarizes
  the main idea and uses sequence arrows, cycle arrows, layered blocks, or a
  side-by-side comparison to show how ideas connect. The optional free-form
  “Explain it like…” style guides the personalized lesson and audio-ready text.
  The audio-ready view remains text, not generated speech. Browser Web Speech
  read-aloud is a separately labeled convenience. The API key is read only by
  the Node server; no key is included in the browser bundle.
- **Work #6 — Lesson Quiz** ✅ — Creates five multiple-choice questions from
  the uploaded lesson, presents one question at a time with four choices and
  progress, then reports the first-attempt score and concepts to review. Wrong
  answers trigger targeted, simpler and visual feedback, a small example, and
  a retry; the optional explanation style also guides written remediation.
- **Work #7 — Adaptive Quiz Difficulty** ✅ — Starts at Medium, raises its
  target after three consecutive correct first answers, and lowers it after two
  consecutive incorrect first answers. The next unused question is selected
  closest to the current target. Previous navigation preserves locked first
  answers; practice retries do not affect the score or adaptive level.
- **Work #8 — Live audio tutor** 🚧 — Audio mode now opens a microphone-controlled,
  one-to-one LiveKit meeting with a lesson-grounded voice tutor, live transcript,
  and mute/end controls. Deepgram handles streaming speech recognition and
  speech synthesis; the existing server-side OpenAI-compatible model handles
  the tutoring conversation. The audio mode does not auto-read a prepared
  passage. Its local VAD/turn-detection models carry a separate LiveKit Model
  License; see [Setup.md](Setup.md) for license and service details. Live use
  requires LiveKit and Deepgram configuration and has not been verified until
  tested audibly on the learner’s laptop.

## Getting started

For the full first-time setup, see [Setup.md](Setup.md).

```bash
npm install
cp .env.example .env
```

Set `AI_API_KEY` in your local `.env` file for lesson adaptation and quizzes.
For live Audio mode, also set `LIVEKIT_URL`, `LIVEKIT_API_KEY`,
`LIVEKIT_API_SECRET`, and `DEEPGRAM_API_KEY`, then run the app and agent in
separate terminals:

```bash
npm run dev
npm run dev:audio-agent
```

`npm run dev` starts the Vite app and Node API; open the URL shown by Vite
(default: http://localhost:5173). The agent command starts the LiveKit voice
worker. If audio is not configured, the app still starts and shows which
server-side values are missing. **Never use a `VITE_` prefix for secret keys
and never commit `.env`.** See [Setup.md](Setup.md) for LiveKit, Deepgram, and
privacy setup details.

PDF text, selected learning preferences, and the optional explanation-style
request are sent to the configured AI provider only when the student chooses
**Generate adaptations**. The lesson text is also sent to the provider when the
student chooses **Create quiz**; if
an answer is incorrect, the lesson, question, and selected answer are sent to
generate targeted feedback. Scanned PDFs without selectable text are not OCR'd.

When the student chooses **Start conversation**, microphone audio is streamed via
LiveKit to Deepgram for transcription; lesson context and conversation turns are
sent to the configured language model, and Deepgram returns the tutor's voice.
The agent explicitly disables LiveKit session recording. Deepgram and the
language-model provider still process the live content, and their retention
policies may apply. The status endpoint checks configuration values only; it
does not verify live service connectivity or audible playback.

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
| `npm run dev:audio-agent` | Start the LiveKit audio tutor worker (requires audio configuration) |
| `npm run build` | Type-check and build the client |
| `npm start` | Serve the built client and API |
| `npm run start:audio-agent` | Start the audio tutor worker in production mode |
| `npm run test` | Run provider, adaptation, quiz, audio-session, and adaptive-difficulty tests |
| `npm run lint` | Lint with oxlint |
