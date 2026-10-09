# First-Time Setup

This guide prepares the AdaptiveLearn AI app for local development. Text lessons and quizzes use the configured OpenAI-compatible model. The **Audio** format is a separate, live one-to-one tutoring meeting; it needs a reachable LiveKit server and Deepgram speech services.

## Requirements

- Node.js **20.19+** or **22.12+** (Vite 8 requirement)
- npm (included with Node.js)
- An API key for an OpenAI-compatible Chat Completions model, if you want lesson adaptation, quizzes, or live Audio mode
- For live Audio mode only: a LiveKit Cloud project or reachable self-hosted LiveKit server, plus a Deepgram API key
- A browser with microphone access; local testing works on `localhost`, while remote access requires HTTPS

The LiveKit Agents, transport, and provider-plugin packages used here are Apache-2.0. This repository has no `LICENSE` file, so its own licensing is not declared. Also, `@livekit/local-inference` is dual-licensed `Apache-2.0 AND LicenseRef-LiveKit-Model`: its bundled VAD and turn-detection models have a separate LiveKit Model License that permits model use only with LiveKit Agents and restricts some reuse of the models and their outputs. Read `node_modules/@livekit/local-inference/MODEL_LICENSE` after install before using or redistributing those model materials; do not describe this entire audio stack as fully open source. LiveKit Cloud, Deepgram, and the configured language-model endpoint are external services; their account requirements, prices, and data-retention policies are separate. Audio mode is not an offline feature.

## Clone this version

This version is on the `arena/d3183c99-adaptivelearn-ai` branch. Clone that branch to get the dashboard, PDF upload, adaptive engine, quiz, and audio-tutor integration:

```bash
git clone --branch arena/d3183c99-adaptivelearn-ai --single-branch https://github.com/SriAkhilSJ/AdaptiveLearn-AI.git
cd AdaptiveLearn-AI
```

Run the remaining commands from the repository root — the directory containing `package.json`.

## 1. Install dependencies

```bash
npm install
```

## 2. Configure the existing AI model

Create `.env` from `.env.example` if you do not already have a local `.env` file:

```bash
# macOS / Linux
cp .env.example .env

# Windows PowerShell
Copy-Item .env.example .env
```

If `.env` already exists, **do not overwrite it**. Add only the missing settings. Set the provider's values privately in `.env`:

```dotenv
AI_PROVIDER=openai-compatible
AI_API_KEY=your-provider-key
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
```

Use your provider's actual API key, base URL, and model name. The spoken tutor reuses this same OpenAI-compatible model. The agent uses streaming Chat Completions, so the endpoint must support streaming responses.

**Keep every key private:** do not paste it into chat, source files, browser code, screenshots, or Git. `.env` is ignored by Git. Never rename a secret to a `VITE_...` variable; Vite variables are exposed to browser code. The Node API and audio agent read keys on the server.

The app can start without an AI key, but adaptation, quizzes, and audio tutoring will not be available until their respective configuration is complete. Restart the affected process after changing `.env`.

## 3. Configure live Audio mode (optional)

Audio mode is a real spoken conversation, not browser text-to-speech. It uses:

- **LiveKit** to create a private audio room and connect the learner to one agent
- **Deepgram** for streaming speech recognition and generated tutor voice
- The existing **AI_API_KEY / AI_BASE_URL / AI_MODEL** for the tutor's lesson-grounded responses
- LiveKit's local voice-activity and turn-detection models for conversation timing; these run in the agent process and need no separate inference key

Add the following values to `.env`:

```dotenv
LIVEKIT_URL=wss://your-livekit-project-host
LIVEKIT_API_KEY=your-livekit-api-key
LIVEKIT_API_SECRET=your-livekit-api-secret
AUDIO_AGENT_NAME=adaptivelearn-audio-tutor
DEEPGRAM_API_KEY=your-deepgram-api-key
AUDIO_STT_MODEL=nova-3
AUDIO_LANGUAGE=en
AUDIO_TTS_MODEL=aura-2-andromeda-en
```

Create a LiveKit Cloud project or configure a self-hosted LiveKit server, then copy its WebSocket URL, API key, and API secret into `.env`. Create a Deepgram API key with access to speech recognition and speech synthesis. The sample voice path is configured for English; if you change `AUDIO_LANGUAGE`, choose a matching STT model and TTS voice that Deepgram supports. Do not send either provider's keys to the browser or to anyone else. `AUDIO_AGENT_NAME` must match in the app and the worker; keep the default unless you intentionally change both.

For local development, keep **two terminals** open from the repository root:

```bash
# Terminal 1: web app and API
npm run dev
```

```bash
# Terminal 2: LiveKit audio agent
npm run dev:audio-agent
```

The audio agent must remain running for a tutor to join. In a deployed setup, deploy the agent worker separately and run the web/API service with the same server-side configuration. The Vite proxy keeps browser requests same-origin; all service secrets stay in the Node API and agent process. This first audio slice does not include student authentication or session rate limits, so keep the API private during laptop testing and add access controls and quotas before exposing it publicly.

Check which required values are missing without displaying any secret:

```bash
curl http://localhost:5173/api/audio/status
```

`configured: true` means the required environment variables are present. This is only a configuration check; it does **not** verify provider connectivity, agent availability, microphone permission, or audible playback. Audio service calls may incur provider usage charges.

## Comic illustrations (optional)

Personalized Learning's **Visual** mode always works without image setup: the learner creates a
3–5 panel text storyboard (captions, dialogue, key ideas, alt text), navigates it panel by panel,
and sees an explicit "illustration generation is not configured" message. Real panel artwork is an
opt-in extra: each illustration is generated only when the learner requests that panel's art, one
panel at a time. No image model is bundled with this repository, and the Chat Completions text
endpoint is never assumed to generate images — artwork goes through a separate server-side image
adapter (`server/providers/image-provider.mjs`) that speaks the OpenAI Images API shape
(`POST {IMAGE_BASE_URL}/images/generations`, `response_format: b64_json`).

Check the current setup without displaying any secret (names only):

```bash
curl http://localhost:5173/api/comic/image-status
```

`configured: true` means the required variables for the selected `IMAGE_PROVIDER` are present.

### Option A — self-hosted image server (recommended if the laptop can run it)

Point the adapter at a local server that exposes an OpenAI-compatible Images endpoint. One
practical choice is [LocalAI](https://github.com/mudler/LocalAI) running a Stable
Diffusion-family image model, but any server with the same endpoint shape works.

```dotenv
IMAGE_PROVIDER=local-openai-compatible
IMAGE_BASE_URL=http://127.0.0.1:8080/v1
IMAGE_MODEL=your-local-image-model-name
IMAGE_API_KEY=
```

`IMAGE_API_KEY` may stay empty for a local server without authentication; it is only sent when
set. Use your server's actual base URL and model name.

**Licenses — read both before downloading anything.** The LocalAI server code is MIT-licensed
(`LICENSE` in the `mudler/LocalAI` repository, verified via GitHub). The image **model weights**
are separate artifacts under their own custom terms (Stable Diffusion-family weights use a
custom Open RAIL-style license, not a standard open-source license — GitHub reports it as
`NOASSERTION`/`Other`). Read the exact model card and license of the weights you download, and do
not describe the whole image stack as open source. This repository itself has no `LICENSE` file,
so its own licensing is not declared.

**Hardware/runtime planning.** Image models are heavy: plan for a GPU with ample VRAM (8 GB class
or more for XL-class models), roughly 10 GB of disk for weights, and Docker or the server's
release binary. CPU-only generation usually works but can take many minutes per panel. These are
planning rules of thumb — confirm current requirements in your image server's and model card's
documentation before installing anything. There is no per-image fee for self-hosting, but real
electricity and hardware costs apply.

### Option B — hosted image endpoint (paid, needs your approval)

Point the adapter at a hosted OpenAI Images-compatible endpoint. Every field is required:

```dotenv
IMAGE_PROVIDER=openai-compatible
IMAGE_BASE_URL=https://api.openai.com/v1
IMAGE_MODEL=your-hosted-image-model-name
IMAGE_API_KEY=your-image-api-key
```

Hosted image calls typically cost money per image — check the provider's current pricing before
enabling this, and treat it as a separate budget decision from the text model. Panel prompts leave
your laptop and are subject to that provider's retention policies.

### Illustration privacy and limits

Each **Generate illustration** request sends only that panel's short scene description plus the
story title to the image service — never the full lesson text. Responses must be PNG, JPEG, or
WebP and at most 4 MB; anything else is rejected. Generated images are returned to the active
browser session only and are not stored on the server. Like the audio endpoints, the comic
endpoints have no student authentication or rate limits in this prototype, so keep the API private
during laptop testing.

## 4. Start the web app

If you have not already started it in step 3:

```bash
npm run dev
```

Open the Vite URL printed in the terminal (normally <http://localhost:5173>). The browser uses same-origin `/api` routes; Vite proxies them to the Node service. Check the AI configuration with:

```bash
curl http://localhost:5173/api/health
```

A configured server responds with `"aiConfigured":true`. The health endpoint never returns the key itself.

## 5. Try the learner flow

1. Open **Start Learning**. Choose learning supports and a learning preference. Optionally enter a story/personification request in **Explain it like…**, then select **Continue**.
2. From the dashboard, select **Start Lesson** or **Upload Lesson**.
3. Browse for or drag in a PDF, then select **Continue** to extract its selectable text locally in the browser.
4. After the upload succeeds, select **Continue** to open the adaptation screen.
5. Review **Original Lesson → AI Adaptation → Personalized Lesson**, then select **Generate adaptations**.
6. Select **Start Personalized Learning** and try **Easy Text**, **Step-by-Step**, or **Visual**. Browser read-aloud is labeled separately and uses the browser's built-in voice; it is not the live tutor.
7. Select **Audio**, then **Start conversation**. The browser asks for microphone permission. The tutor should greet you and ask what you want to work through; speak naturally, use the mute control, and end the meeting when finished. Conversation turns appear in the transcript. Selecting **Audio** alone does not turn on the microphone or play a prepared passage.
8. Select **Create quiz** in **Check your understanding**. The five generated questions include two Easy, two Medium, and one Hard question. The target starts at Medium; after three consecutive correct first answers it rises one level, and after two consecutive incorrect first answers it drops one level. Each next question is the unused question closest to the current target. Use **Previous** to review: once submitted, a first answer is locked and revisits do not change the score or difficulty. An incorrect answer triggers a simpler explanation, a visual diagram, a small example, and an optional practice retry; retries do not affect score or difficulty. At the end, review the first-attempt score and concepts for missed answers.

If Audio setup is incomplete, the Audio panel lists the missing **variable names** only. Add their values privately in `.env`, restart the app and worker, then try again. The setup panel does not prove that the external services are reachable.

## Audio privacy and testing

The microphone starts only after the learner selects **Start conversation**. Live microphone audio is sent through LiveKit to the configured speech-recognition service. The lesson text and saved learning preferences are passed to the agent for that session; recognized conversation turns go to the configured language model, and generated tutor speech is returned through Deepgram. The agent explicitly disables LiveKit session recording, but Deepgram and the model provider still process the content and their retention policies may apply. Review provider policies before using real student or sensitive material.

Verify the audio **audibly on the learner's actual laptop**: allow microphone access, say a short question about the uploaded lesson, confirm the tutor answers aloud and the transcript updates, mute/unmute, then end the meeting. A successful build, API status, or sandbox preview alone is not an audible test. Do not report live audio as verified until that device test succeeds.

## File and text limits

- PDF upload: maximum **25 MB**
- AI adaptation request: maximum **60,000 extracted characters**
- Audio tutor lesson context: maximum **60,000 extracted characters**
- The PDF must contain selectable text; image-only/scanned PDFs need OCR, which is not included

Recent lesson names, accessibility preferences, and the optional explanation-style request are stored in this browser. The currently uploaded lesson text is kept in the active app session for the adaptation flow. When a live audio meeting is started, the lesson and relevant adaptation context are also sent to LiveKit as per-session agent-dispatch metadata and to the configured AI services for the conversation.

## Useful commands

```bash
npm run dev              # Start frontend and API together
npm run dev:audio-agent  # Start the LiveKit tutor worker for local development
npm test                 # Run provider, lesson, quiz, comic, audio-session, and difficulty tests
npm run lint             # Run oxlint
npm run build            # Type-check and build the frontend
npm start                # Serve the production build and API (run build first)
npm run start:audio-agent # Start the audio worker in production mode
```

`npm start` serves the built app and API on port `4173` by default. Set `PORT` in the server environment to change it. The audio worker is a separate process.

## Troubleshooting

- **“AI_API_KEY is not configured”** — Set the key in `.env`, save it, and restart `npm run dev` and/or `npm run dev:audio-agent`.
- **The provider rejects the key** — Check that the key belongs to the selected provider and that `AI_BASE_URL`, `AI_MODEL`, and streaming Chat Completions are supported.
- **Audio setup lists missing values** — Add the named LiveKit/Deepgram values to the server-side `.env`; do not add `VITE_` prefixes.
- **The tutor did not join** — Check the LiveKit URL/keys, `AUDIO_AGENT_NAME`, network access, and that `npm run dev:audio-agent` is still running. The agent must have the same name configured as the dispatching API.
- **The tutor joins but does not answer** — Check the Deepgram key and AI provider endpoint/model, including streaming support. Review the private server/agent terminal logs; never paste keys or secret-bearing logs into chat.
- **No microphone permission or audio** — Use HTTPS or `localhost`, allow microphone access in the browser, check the selected microphone and speaker, and make sure audio is not muted by the operating system.
- **LiveKit self-hosting** — A browser on another device cannot connect to the user's `localhost`; configure a reachable server URL and the needed network/firewall access.
- **The AI provider cannot be reached** — Check the endpoint, internet/network access, and provider status. The server must be able to reach the provider.
- **“Illustration generation is not configured”** — Visual mode is working as designed in text-only form. To enable real artwork, set the named `IMAGE_*` values in the server-side `.env` (see “Comic illustrations” above), restart with `npm run dev`, and check `/api/comic/image-status`. The status lists missing variable names only.
- **“The image service rejected the configured key”** — Check `IMAGE_API_KEY` against the image endpoint (not the text-model key), plus `IMAGE_BASE_URL` and `IMAGE_MODEL`.
- **“The image service could not be reached”** — For self-hosting, confirm the local image server is running and reachable at `IMAGE_BASE_URL`, then retry one panel.
- **“No selectable text was found”** — This PDF is likely scanned or image-only. Use a text-based PDF; OCR is not included.
- **Lesson too long** — The current adaptation and audio-context limits are 60,000 extracted characters.
- **Port already in use** — Stop the other app using port `5173` (Vite) or `8787` (development API), or free that port before starting the app. If `npm run dev` crashes with `EADDRINUSE 0.0.0.0:8787`, a previous copy of this app (possibly from another session) is still holding the API port — the development API port is fixed at 8787. Find it with `lsof -i :8787` (macOS/Linux) or `netstat -ano | findstr 8787` (Windows), stop that process, then start again.

## Instructions for a coding agent

When asked to set up or verify this repository, the agent should:

1. Read this guide and work from the repository root.
2. Check the active Node.js version, then run `npm install` if dependencies are missing.
3. If `.env` is absent, copy `.env.example` to `.env`; if `.env` already exists, do not overwrite it. Leave missing keys blank unless the developer has already configured them privately. Never ask the user to send a key in chat.
4. Run `npm test`, `npm run lint`, and `npm run build`; fix setup-related failures without exposing secrets.
5. Start `npm run dev`, verify the frontend, `/api/health`, and `/api/audio/status`, and report missing variable names without printing values.
6. Do not call real AI, LiveKit, or speech providers unless keys are already configured and a live session is explicitly requested. Use mock-based tests for ordinary verification.
7. Only report an audio session as working after verifying a real spoken exchange and audible tutor response on the user's laptop. A sandbox preview, passing tests, or `configured: true` is not enough.
8. Never commit `.env` or include any API key in client code, logs, screenshots, or documentation. Follow the repository's active branch and Git instructions.

### Ready-to-use Desktop Agent request

> Clone the `arena/d3183c99-adaptivelearn-ai` branch from `https://github.com/SriAkhilSJ/AdaptiveLearn-AI.git`, read `Setup.md`, and handle first-time setup end-to-end. Do not overwrite an existing `.env`; if it is missing, copy `.env.example` but leave keys blank. Never ask me to paste credentials or print, screenshot, commit, or send any secret. Install dependencies; run `npm test`, `npm run lint`, and `npm run build`; start the web app; and verify the frontend, `/api/health`, `/api/audio/status`, the PDF upload/extraction flow, and the Original Lesson → AI Adaptation → Personalized Learning flow using a small text-based test PDF. Confirm that Audio selection itself does not start the microphone or read a prepared passage; it must show a one-to-one, lesson-grounded conversation UI with explicit start, mute, end, and transcript controls. If audio credentials are already configured privately, start `npm run dev:audio-agent` and perform a real audible question-and-answer test on this laptop, then test mute/unmute and end-call. If the LiveKit, Deepgram, or model values are missing, do not request them and do not claim live audio works; report only the missing variable names and let me configure them locally. Do not make live paid provider calls unless I explicitly request them. Also verify that saved preferences and the optional “Explain it like…” input reach lesson adaptation without changing lesson facts; Visual mode is a learner-controlled static comic storyboard (panels never auto-advance, illustrations generate only on request, and the overview diagram stays available under “Show overview diagram”), not generated video. Verify the quiz still presents exactly five questions with four choices, two Easy, two Medium, one Hard, adaptive level changes, locked first answers, and practice retries excluded from scoring. Never expose or commit `.env`.
