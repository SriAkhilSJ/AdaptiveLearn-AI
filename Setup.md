# First-Time Setup

This guide prepares the AdaptiveLearn AI app for local development and first use.

## Requirements

- Node.js **20.19+** or **22.12+** (Vite 8 requirement)
- npm (included with Node.js)
- An API key for an AI provider that supports the configured OpenAI-compatible Chat Completions API, if you want to generate adaptations

## Clone this version

This version is on the `arena/d3183c99-adaptivelearn-ai` branch. Clone that branch to get the dashboard, PDF upload, adaptive engine, and this setup guide:

```bash
git clone --branch arena/d3183c99-adaptivelearn-ai --single-branch https://github.com/SriAkhilSJ/AdaptiveLearn-AI.git
cd AdaptiveLearn-AI
```

Run the remaining commands from the repository root — the directory containing `package.json`.

## 1. Install dependencies

```bash
npm install
```

## 2. Configure the AI provider

Create a local environment file from the example:

```bash
# macOS / Linux
cp .env.example .env

# Windows PowerShell
Copy-Item .env.example .env
```

Open `.env` and set `AI_API_KEY` to your provider key. The other settings are optional:

```dotenv
AI_PROVIDER=openai-compatible
AI_API_KEY=your-provider-key
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
```

Use the provider's actual key and endpoint. **Keep the key private:** do not paste it into chat, source files, browser code, or commit it to Git. `.env` is ignored by Git. Never rename it to a `VITE_...` variable; Vite variables are exposed to browser code. The Node API reads the key on the server.

The app can start without a key, but lesson adaptation, quiz generation, and quiz feedback will show a setup message until `AI_API_KEY` is configured. Restart `npm run dev` after changing `.env`.

## 3. Start the app

```bash
npm run dev
```

This starts both the Vite frontend and Node API. Open the Vite URL printed in the terminal (normally <http://localhost:5173>). The browser uses the same-origin `/api` route; Vite proxies it to the Node service.

To check the API configuration, open <http://localhost:5173/api/health> or run:

```bash
curl http://localhost:5173/api/health
```

A configured server responds with `"aiConfigured":true`. If it is `false`, check `.env` and restart the app. The health endpoint never returns the key itself.

## 4. Try the student flow

1. Open **Start Learning**. Choose learning supports and a learning preference. Optionally enter a story/personification request in **Explain it like…** (for example, “a One Piece anime adventure”), then select **Continue**.
2. From the dashboard, select **Start Lesson** or **Upload Lesson**.
3. Browse for or drag in a PDF, then select **Continue** to extract its text.
4. After the upload succeeds, select **Continue** to open the adaptation screen.
5. Review **Original Lesson → AI Adaptation → Personalized Lesson**, then select **Generate adaptations**.
6. Select **Start Personalized Learning**. Switch among **Easy Text**, **Step-by-Step**, **Visual**, and **Audio**. Selecting **Audio** starts the browser's built-in voice; use its **Play audio / Stop audio** control or the **Listen** action to control playback. Use **Explain More Simply** for easy text, **Show Visual** for the diagram, or **Explain Again** to hear the step-by-step version.
7. Select **Create quiz** in **Check your understanding**. The five generated questions include two Easy, two Medium, and one Hard question. The target starts at Medium; after three consecutive correct first answers it rises one level, and after two consecutive incorrect first answers it drops one level. Each next question is the unused question closest to the current target. Use **Previous** to review: once submitted, a first answer is locked and revisits do not change the score or difficulty. An incorrect answer triggers a simpler explanation, a visual diagram, a small example, and an optional practice retry; retries do not affect score or difficulty. At the end, review the first-attempt score and concepts for missed answers.

The engine returns standard, easy-to-read, step-by-step, visual, and audio-ready explanations, plus a personalized lesson based on saved preferences. The optional **Explain it like…** request currently shapes the personalized lesson, audio-ready wording, and quiz remediation; it does not generate video yet. The visual version remains a concise whole-lesson diagram. Audio-ready text is a short spoken overview, read by the browser's Web Speech API with a visible transcript. Available voices depend on the browser and device.

PDF text, saved learning preferences, and the optional explanation-style request are sent to the configured AI provider only after the student chooses **Generate adaptations**. The uploaded lesson text is also sent to the configured provider only when **Create quiz** is selected. After an incorrect response, the lesson text, question, selected answer, and optional style are sent to generate targeted feedback. PDF text extraction happens locally in the browser. Scanned/image-only PDFs are not OCR'd.

## File and text limits

- PDF upload: maximum **25 MB**
- AI adaptation request: maximum **60,000 extracted characters**
- The PDF must contain selectable text; image-only/scanned PDFs need OCR, which is not included

Recent lesson names, accessibility preferences, and the optional explanation-style request are stored in this browser. The currently uploaded lesson text is kept in the active app session for the adaptation flow.

## Useful commands

```bash
npm run dev       # Start frontend and API together
npm test          # Run AI provider, lesson service, quiz, and difficulty tests
npm run lint      # Run oxlint
npm run build     # Type-check and build the frontend
npm start         # Serve the production build and API (run build first)
```

`npm start` serves the built app and API on port `4173` by default. Set `PORT` in the server environment to change it.

## Troubleshooting

- **“AI_API_KEY is not configured”** — Set the key in `.env`, save it, and restart `npm run dev`.
- **The provider rejects the key** — Check that the key belongs to the selected provider and that `AI_BASE_URL` and `AI_MODEL` are correct.
- **The AI provider cannot be reached** — Check the endpoint, internet/network access, and provider status. The server must be able to reach the provider.
- **“No selectable text was found”** — This PDF is likely scanned or image-only. Use a text-based PDF; OCR is not included.
- **Lesson too long** — The current API limit is 60,000 extracted characters per adaptation request.
- **Port already in use** — Stop the other app using port `5173` (Vite) or `8787` (development API), or free that port before starting the app.

## Instructions for a coding agent

When asked to set up or verify this repository, the agent should:

1. Read this guide and work from the repository root.
2. Check the active Node.js version, then run `npm install` if dependencies are missing.
3. If `.env` is absent, copy `.env.example` to `.env` but leave `AI_API_KEY` blank unless the developer has already configured it privately. Never ask the user to send a key in chat.
4. Run `npm test`, `npm run lint`, and `npm run build`; fix setup-related failures without exposing secrets.
5. Start `npm run dev`, verify the frontend and `/api/health`, and report whether an AI key is configured without printing the key.
6. Do not call the real AI provider unless a key is already configured and a live provider request is explicitly requested. Use the existing mock-based tests for ordinary verification.
7. Never commit `.env` or include any API key in client code, logs, screenshots, or documentation. Follow the repository's active branch and Git instructions.

### Ready-to-use Desktop Agent request

> Clone the `arena/d3183c99-adaptivelearn-ai` branch from `https://github.com/SriAkhilSJ/AdaptiveLearn-AI.git`, read `Setup.md`, and handle first-time setup end-to-end. Install dependencies; run `npm test`, `npm run lint`, and `npm run build`; start the app; and verify the frontend, `/api/health`, the PDF upload/extraction flow, and the Original Lesson → AI Adaptation → Personalized Learning flow using a small text-based test PDF. Check that saved preferences and the optional “Explain it like…” input reach the adaptation service; verify that the requested lens shapes the personalized lesson, audio-ready text, and quiz remediation without changing facts from the PDF. Confirm the four format controls work and Audio/Listen/Explain Again use browser speech or show the supported fallback. Do not claim the app generates video yet. Verify the lesson quiz presents exactly five questions one at a time with four answer choices and progress controls, with exactly two Easy, two Medium, and one Hard question; starts at Medium; raises the next-question target one level after three consecutive correct first answers and lowers it one level after two consecutive incorrect first answers; chooses the closest unused question; preserves locked first answers when using Previous; and keeps practice retries out of the score and difficulty streaks. Also verify simpler/visual/example feedback after a wrong answer, the final first-attempt score out of five, and missed concepts. Do not ask me to paste credentials. If no private `AI_API_KEY` is already configured, do not make a live provider request; use the existing mock-based tests and tell me live generation needs a private local key. Never expose or commit `.env`.
