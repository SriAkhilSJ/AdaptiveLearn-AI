/**
 * TalkWithGesture operator UI.
 *
 * Camera frames are sent as binary JPEG over a WebSocket to the local Python
 * server, which runs MediaPipe + the gesture classifier and streams back the
 * translation state. Speech is produced by the browser's own Speech Synthesis
 * API using the operating system's voices -- no network request is involved
 * anywhere in this page.
 */

const $ = (id) => document.getElementById(id);

const el = {
  video: $("video"),
  overlay: $("overlay"),
  noCamera: $("no-camera"),
  fps: $("fps"),
  hands: $("hands"),
  latency: $("latency"),
  sign: $("current-sign"),
  confidence: $("current-confidence"),
  description: $("sign-description"),
  reason: $("sign-reason"),
  top3: $("top3"),
  ringFg: $("ring-fg"),
  sentence: $("sentence"),
  sentenceAlt: $("sentence-alt"),
  pending: $("pending"),
  phraseBanner: $("phrase-banner"),
  phraseEn: $("phrase-en"),
  phraseHi: $("phrase-hi"),
  phraseEmoji: $("phrase-emoji"),
  domains: $("domains"),
  cards: $("cards"),
  modelInfo: $("model-info"),
  engines: $("engines"),
  alphabet: $("alphabet"),
  start: $("btn-start"),
  endWord: $("btn-endword"),
  clear: $("btn-clear"),
  speak: $("chk-speak"),
  landmarks: $("chk-landmarks"),
  langEn: $("lang-en"),
  langHi: $("lang-hi"),
  offlineBadge: $("offline-badge"),
  offlineText: $("offline-text"),
};

const RING_CIRCUMFERENCE = 2 * Math.PI * 52;
const CAPTURE_WIDTH = 480;
const state = {
  language: "en",
  domain: "general",
  stream: null,
  ws: null,
  capture: document.createElement("canvas"),
  inFlight: false,
  lastSent: 0,
  state: null,
};

/* ------------------------------------------------------------------ boot */

async function boot() {
  renderStatic();
  try {
    const response = await fetch("/api/state");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const info = await response.json();
    renderState(info);
    // Do not clobber the "streaming" state when boot() is re-run for a language switch.
    if (!state.ws || state.ws.readyState > WebSocket.OPEN) setOffline(true, "offline · no cloud");
  } catch (error) {
    setOffline(false, `server unreachable: ${error.message}`);
  }
}

function setOffline(ok, text) {
  el.offlineText.textContent = text;
  el.offlineBadge.className = `badge ${ok ? "badge-on" : "badge-off"}`;
}

function renderStatic() {
  el.ringFg.style.strokeDasharray = `${RING_CIRCUMFERENCE}`;
  el.ringFg.style.strokeDashoffset = `${RING_CIRCUMFERENCE}`;
}

function renderState(info) {
  const m = info.model || {};
  el.modelInfo.innerHTML = [
    ["Classes", `${m.n_classes ?? "?"} (A–Z, 0–9)`],
    ["Held-out accuracy", m.test_accuracy ? `${(m.test_accuracy * 100).toFixed(2)}%` : "–"],
    ["Features / frame", m.feature_dim ?? "–"],
    ["Classifier", "Random forest + PCA, scikit-learn"],
    ["Perception", "MediaPipe Hands (bundled TFLite)"],
    ["Stability gate", `${info.smoother?.stable_frames ?? "?"} frames @ ${(info.smoother?.confidence_threshold ?? 0).toFixed(2)}`],
  ]
    .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
    .join("");

  const tts = info.tts || {};
  el.engines.innerHTML = (tts.engines || [])
    .map((e) => {
      const isDefault = e.name === tts.default;
      const mark = e.available ? '<span class="ok">✔</span>' : '<span class="no">–</span>';
      const label = e.available ? e.name : `${e.name} (unavailable)`;
      return `<li class="${isDefault ? "default" : ""}">${mark}<span class="name">${label}</span>` +
             `<span class="detail">${e.detail}${e.available && !e.supports_hindi ? " · no Hindi voice" : ""}</span></li>`;
    })
    .join("");

  renderDomains(info.domains || []);
  window.__phrases = info.phrases || [];
  renderCards();

  el.alphabet.innerHTML = (info.fingerspell || [])
    .map((c) => `<span data-sign="${c}">${c}</span>`)
    .join("");
}

function renderDomains(domains) {
  el.domains.innerHTML = domains
    .map(
      (d) =>
        `<button data-domain="${d.id}" class="${d.id === state.domain ? "active" : ""}">${d.emoji} ${
          state.language === "hi" ? d.label_hi : d.label_en
        }</button>`
    )
    .join("");
  el.domains.querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => {
      state.domain = b.dataset.domain;
      el.domains.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
      renderCards();
    })
  );
}

function renderCards() {
  const phrases = (window.__phrases || []).filter(
    (p) => state.domain === "general" || p.domain === state.domain || p.domain === "general"
  );
  el.cards.innerHTML = phrases
    .map(
      (p) =>
        `<button class="card" data-id="${p.id}">
           <span class="card-emoji">${p.emoji}</span>
           <span class="card-en">${state.language === "hi" ? p.hi : p.en}</span>
           <span class="card-hi">${state.language === "hi" ? p.hi_transl : p.hi}</span>
         </button>`
    )
    .join("");
  el.cards.querySelectorAll(".card").forEach((c) =>
    c.addEventListener("click", () => sendControl({ type: "quick", id: c.dataset.id }))
  );
}

/* ------------------------------------------------------------- websocket */

function wsUrl() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws/vision`;
}

function connect() {
  if (state.ws && state.ws.readyState <= WebSocket.OPEN) return;
  const ws = new WebSocket(wsUrl());
  ws.binaryType = "arraybuffer";
  state.ws = ws;

  ws.addEventListener("open", () => {
    setOffline(true, "offline · streaming");
    sendControl({ type: "language", lang: state.language });
    state.inFlight = false;
    scheduleCapture();
  });

  ws.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type === "frame") {
      state.inFlight = false;
      render(message);
      scheduleCapture();
    } else if (message.type === "error") {
      el.reason.textContent = `error: ${message.detail}`;
      state.inFlight = false;
    }
  });

  ws.addEventListener("close", () => setOffline(false, "disconnected"));
  ws.addEventListener("error", () => setOffline(false, "websocket error"));
}

function sendControl(payload) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(payload));
  }
}

/* --------------------------------------------------------------- camera */

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    el.noCamera.classList.remove("hidden");
    return;
  }
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 960 }, height: { ideal: 540 }, facingMode: "user" },
      audio: false,
    });
    el.video.srcObject = state.stream;
    await el.video.play();
    el.noCamera.classList.add("hidden");
    el.start.textContent = "Camera on";
    el.start.disabled = true;
    connect();
  } catch (error) {
    el.noCamera.classList.remove("hidden");
    el.noCamera.querySelector("p").textContent = `Camera denied: ${error.message}`;
  }
}

/** Capture at most ~15 fps, and never more than one frame in flight. */
function scheduleCapture() {
  if (state.inFlight || !state.stream || !state.ws || state.ws.readyState !== WebSocket.OPEN) return;
  const wait = Math.max(0, 1000 / 15 - (performance.now() - state.lastSent));
  setTimeout(captureAndSend, wait);
}

function captureAndSend() {
  if (!state.stream || !state.ws || state.ws.readyState !== WebSocket.OPEN) return;
  const video = el.video;
  if (!video.videoWidth) return scheduleCapture();

  const scale = Math.min(1, CAPTURE_WIDTH / video.videoWidth);
  const canvas = state.capture;
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);

  state.inFlight = true;
  state.lastSent = performance.now();
  canvas.toBlob((blob) => {
    if (!blob) {
      state.inFlight = false;
      return scheduleCapture();
    }
    blob.arrayBuffer().then((buffer) => {
      if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(buffer);
      else state.inFlight = false;
    });
  }, "image/jpeg", 0.72);
}

/* --------------------------------------------------------------- render */

function render(message) {
  state.state = message;

  el.fps.textContent = message.fps ?? "–";
  el.hands.textContent = message.hands ?? 0;
  // Round trip is measured client-side: it covers JPEG encode + WebSocket +
  // MediaPipe + classifier, i.e. what the signer actually feels.
  el.latency.textContent = state.lastSent ? `${Math.round(performance.now() - state.lastSent)} ms` : "–";

  drawLandmarks(message.landmarks || []);

  const progress = message.progress ?? 0;
  el.ringFg.style.strokeDashoffset = `${RING_CIRCUMFERENCE * (1 - progress)}`;
  el.ringFg.classList.toggle("locked", !!message.committed);

  el.sign.textContent = message.committed || message.sign || "–";
  el.confidence.textContent = `${Math.round((message.confidence ?? 0) * 100)}%`;
  el.description.textContent = message.committedDescription ||
    (message.sign ? `ISL fingerspelling “${message.sign}”` : "Waiting for a hand…");
  el.reason.textContent = message.reason || "";

  el.top3.innerHTML = (message.top3 || [])
    .map((t, i) => `<span class="${i === 0 ? "lead" : ""}">${t.label} ${(t.confidence * 100).toFixed(0)}%</span>`)
    .join("");

  const en = message.sentenceEn || "";
  const hi = message.sentenceHi || "";
  if (state.language === "hi") {
    el.sentence.textContent = hi || "शुरुआत के लिए संकेत करें।";
    el.sentence.setAttribute("lang", "hi");
    el.sentenceAlt.textContent = en;
    el.sentenceAlt.setAttribute("lang", "en");
  } else {
    el.sentence.textContent = en || "Sign to begin. The sentence appears here.";
    el.sentence.setAttribute("lang", "en");
    el.sentenceAlt.textContent = hi;
    el.sentenceAlt.setAttribute("lang", "hi");
  }
  el.pending.textContent = message.pendingWord || "";

  if (message.phrase) {
    el.phraseEmoji.textContent = message.phrase.emoji || "💬";
    el.phraseEn.textContent = message.phrase.en;
    el.phraseHi.textContent = `${message.phrase.hi}  ·  ${message.phrase.hiTranslit}`;
    el.phraseBanner.classList.remove("hidden");
  } else if (message.utteranceDone) {
    el.phraseBanner.classList.add("hidden");
  }

  highlightAlphabet(message.committed);
  if (message.speak && el.speak.checked) speakNow(message.speak.text, message.speak.lang);
}

function drawLandmarks(landmarks) {
  const canvas = el.overlay;
  const rect = canvas.getBoundingClientRect();
  if (canvas.width !== rect.width || canvas.height !== rect.height) {
    canvas.width = Math.max(1, Math.round(rect.width));
    canvas.height = Math.max(1, Math.round(rect.height));
  }
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!el.landmarks.checked || landmarks.length < 21) return;

  const CONNECTIONS = [
    [0,1],[1,2],[2,3],[3,4],
    [0,5],[5,6],[6,7],[7,8],
    [5,9],[9,10],[10,11],[11,12],
    [9,13],[13,14],[14,15],[15,16],
    [13,17],[17,18],[18,19],[19,20],
    [0,17],
  ];
  const w = canvas.width;
  const h = canvas.height;
  const toXY = (p) => [(1 - p[0]) * w, p[1] * h]; // mirrored to match the selfie view

  for (let hand = 0; hand * 21 < landmarks.length; hand++) {
    const pts = landmarks.slice(hand * 21, hand * 21 + 21);
    ctx.strokeStyle = hand === 0 ? "rgba(34,197,94,0.95)" : "rgba(56,189,248,0.95)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (const [a, b] of CONNECTIONS) {
      const [x1, y1] = toXY(pts[a]);
      const [x2, y2] = toXY(pts[b]);
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    }
    ctx.stroke();
    pts.forEach((p, i) => {
      const [x, y] = toXY(p);
      ctx.beginPath();
      ctx.arc(x, y, i === 0 ? 5 : 3.2, 0, Math.PI * 2);
      ctx.fillStyle = i === 0 ? "#facc15" : "#ffffff";
      ctx.fill();
    });
  }
}

function highlightAlphabet(sign) {
  el.alphabet.querySelectorAll("span").forEach((s) => s.classList.toggle("hit", s.dataset.sign === sign));
}

/* ----------------------------------------------------------------- speech */

let voices = [];
function loadVoices() {
  voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
}
if (window.speechSynthesis) {
  loadVoices();
  window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
}

function pickVoice(lang) {
  const prefix = lang === "hi" ? "hi" : "en";
  if (!voices.length) loadVoices();
  // Prefer an Indian voice, then any voice for the language, then the default.
  return (
    voices.find((v) => v.lang.toLowerCase().startsWith(`${prefix}-in`)) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(prefix)) ||
    null
  );
}

function speakNow(text, lang) {
  if (!window.speechSynthesis || !text) return;
  // Drop anything queued so the clerk hears the latest sentence, not a backlog.
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = pickVoice(lang || state.language);
  if (voice) utterance.voice = voice;
  utterance.lang = voice ? voice.lang : lang === "hi" ? "hi-IN" : "en-IN";
  utterance.rate = 0.95;
  window.speechSynthesis.speak(utterance);
}

/* ------------------------------------------------------------------ events */

el.start.addEventListener("click", startCamera);
el.endWord.addEventListener("click", () => sendControl({ type: "flush" }));
el.clear.addEventListener("click", () => {
  sendControl({ type: "reset" });
  el.phraseBanner.classList.add("hidden");
  el.sentence.textContent = state.language === "hi" ? "शुरुआत के लिए संकेत करें।" : "Sign to begin. The sentence appears here.";
  el.sentenceAlt.textContent = "";
  el.pending.textContent = "";
});
el.langEn.addEventListener("click", () => setLanguage("en"));
el.langHi.addEventListener("click", () => setLanguage("hi"));

function setLanguage(lang) {
  state.language = lang;
  el.langEn.classList.toggle("active", lang === "en");
  el.langHi.classList.toggle("active", lang === "hi");
  sendControl({ type: "language", lang });
  boot().catch(() => {}); // re-render the cards in the new language
}

document.addEventListener("keydown", (event) => {
  if (event.code === "Space" && document.activeElement === document.body) {
    event.preventDefault();
    sendControl({ type: "flush" });
  }
});

boot();
