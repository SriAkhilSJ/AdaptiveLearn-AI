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

The app can start without a key, but **Generate adaptations** will show a setup message until `AI_API_KEY` is configured. Restart `npm run dev` after changing `.env`.

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

1. Open **Start Learning**. Choose learning supports and a learning preference, then select **Continue**.
2. From the dashboard, select **Start Lesson** or **Upload Lesson**.
3. Browse for or drag in a PDF, then select **Continue** to extract its text.
4. After the upload succeeds, select **Continue** to open the adaptation screen.
5. Review **Original Lesson → AI Adaptation → Personalized Lesson**, then select **Generate adaptations**.

The engine returns standard, easy-to-read, step-by-step, visual, and audio-ready explanations, plus a personalized lesson based on the saved preferences. The visual version is a text-based diagram/layout; the audio-ready version is prepared for reading aloud but does not include audio playback.

PDF text and saved learning preferences are sent to the configured AI provider only after the student chooses **Generate adaptations**. PDF text extraction happens locally in the browser. Scanned/image-only PDFs are not OCR'd.

## File and text limits

- PDF upload: maximum **25 MB**
- AI adaptation request: maximum **60,000 extracted characters**
- The PDF must contain selectable text; image-only/scanned PDFs need OCR, which is not included

Recent lesson names and accessibility preferences are stored in this browser. The currently uploaded lesson text is kept in the active app session for the adaptation flow.

## Useful commands

```bash
npm run dev       # Start frontend and API together
npm test          # Run AI provider and adaptation-service tests
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

> Clone the `arena/d3183c99-adaptivelearn-ai` branch from `https://github.com/SriAkhilSJ/AdaptiveLearn-AI.git`, read `Setup.md`, and handle first-time setup end-to-end. Install dependencies; run `npm test`, `npm run lint`, and `npm run build`; start the app; and verify the frontend, `/api/health`, the PDF upload/extraction flow, and the Original Lesson → AI Adaptation → Personalized Lesson flow using a small text-based test PDF. Check that the saved learning preferences reach the adaptation service. Do not ask me to paste credentials. If no private `AI_API_KEY` is already configured, do not make a live provider request; use the existing mock-based tests and tell me live generation needs a private local key. Never expose or commit `.env`.
