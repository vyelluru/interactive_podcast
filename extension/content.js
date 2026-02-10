// extension/content.js

let lastState = null;

// =====================
// Utils
// =====================
function parseTimeToSeconds(mmss) {
  // Accepts "1:23" or "01:23" or "1:02:03"
  if (!mmss || typeof mmss !== "string") return null;
  const parts = mmss.split(":").map((p) => p.trim());
  if (parts.some((p) => p === "" || isNaN(Number(p)))) return null;

  if (parts.length === 2) {
    const [m, s] = parts.map(Number);
    return m * 60 + s;
  }
  if (parts.length === 3) {
    const [h, m, s] = parts.map(Number);
    return h * 3600 + m * 60 + s;
  }
  return null;
}

// =====================
// Spotify DOM extraction
// =====================
function getPodcastAndEpisodeFromDOM() {
  // Episode anchor (stable signal)
  const episodeA = document.querySelector('a[href*="/episode/"]');

  let episodeTitle = null;
  let episodeId = null;
  let episodeUrl = null;

  if (episodeA) {
    const href = episodeA.getAttribute("href") || "";
    const match = href.match(/\/episode\/([a-zA-Z0-9]+)/);
    episodeId = match ? match[1] : null;

    episodeUrl = href
      ? href.startsWith("http")
        ? href
        : `https://open.spotify.com${href}`
      : null;

    episodeTitle =
      (episodeA.getAttribute("aria-label") || episodeA.textContent || "").trim() ||
      null;
  }

  // Show / podcast name (try near now playing bar; fallback to any /show/)
  let showName = null;

  const nowPlayingBar =
    document.querySelector('[data-testid="now-playing-bar"]') ||
    document.querySelector("footer") ||
    document.querySelector('[role="contentinfo"]');

  const showA =
    nowPlayingBar?.querySelector('a[href*="/show/"]') ||
    (episodeA
      ? episodeA
          .closest(
            'footer, [data-testid="now-playing-bar"], [class*="now-playing"], [role="contentinfo"]'
          )
          ?.querySelector('a[href*="/show/"]')
      : null) ||
    document.querySelector('a[href*="/show/"]');

  if (showA) {
    showName =
      (showA.getAttribute("aria-label") || showA.textContent || "").trim() || null;
  }

  // Fallback: MediaSession (often sets artist to show name for podcasts)
  if (!showName && navigator.mediaSession?.metadata) {
    const md = navigator.mediaSession.metadata;
    showName = (md.artist || md.album || "").trim() || null;
  }

  return { showName, episodeTitle, episodeId, episodeUrl };
}

function getPlaybackTimeFromDOM() {
  const posEl =
    document.querySelector('[data-testid="playback-position"]') ||
    document.querySelector('[data-testid="playback-position"] span') ||
    null;

  const durEl =
    document.querySelector('[data-testid="playback-duration"]') ||
    document.querySelector('[data-testid="playback-duration"] span') ||
    null;

  const positionText = posEl?.textContent?.trim() || null;
  const durationText = durEl?.textContent?.trim() || null;

  const positionSeconds = parseTimeToSeconds(positionText);
  const durationSeconds = parseTimeToSeconds(durationText);

  return { positionText, positionSeconds, durationText, durationSeconds };
}

function getPlayStateFromDOM() {
  const btn =
    document.querySelector('button[aria-label="Pause"]') ||
    document.querySelector('button[aria-label="Play"]') ||
    document.querySelector('button[data-testid="control-button-playpause"]') ||
    null;

  const aria = btn?.getAttribute("aria-label") || "";
  const isPlaying = aria === "Pause" ? true : aria === "Play" ? false : null;

  return { isPlaying };
}

function buildState() {
  const meta = getPodcastAndEpisodeFromDOM();
  const time = getPlaybackTimeFromDOM();
  const play = getPlayStateFromDOM();

  return {
    source: "spotify_web",
    detectedAtMs: Date.now(),
    ...meta,
    ...time,
    ...play,
  };
}

function stateChanged(a, b) {
  if (!a) return true;

  const keys = [
    "episodeId",
    "episodeTitle",
    "episodeUrl",
    "showName",
    "positionSeconds",
    "positionText",
    "durationSeconds",
    "durationText",
    "isPlaying",
  ];
  return keys.some((k) => a[k] !== b[k]);
}

// =====================
// Polling + state caching
// =====================
function poll() {
  const s = buildState();

  // Valid if we have time — episode metadata can be null sometimes
  const isValid = s.positionSeconds != null;

  if (isValid && stateChanged(lastState, s)) {
    lastState = s;
    console.log("[InteractivePodcast] state:", s);
  } else if (!lastState) {
    lastState = s;
  }
}

setInterval(poll, 750);
poll();

// =====================
// Popup message handler (merged)
// =====================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Popup / debug: get current Spotify state
  if (msg?.type === "GET_SPOTIFY_STATE") {
    sendResponse({ ok: true, state: lastState });
    return true;
  }

  // Background script ping (used to check if content.js is alive)
  if (msg?.type === "PING") {
    sendResponse({ ok: true });
    return true;
  }

  // Toggle overlay (extension icon click or hotkey)
  if (msg?.type === "TOGGLE_OVERLAY") {
    setOverlayOpen(!overlayOpen);
    sendResponse({ ok: true });
    return true;
  }

  // Explicit open
  if (msg?.type === "OPEN_OVERLAY") {
    setOverlayOpen(true);
    sendResponse({ ok: true });
    return true;
  }

  // Explicit close
  if (msg?.type === "CLOSE_OVERLAY") {
    setOverlayOpen(false);
    sendResponse({ ok: true });
    return true;
  }
});

// =====================
// Backend calls (Phase 2)
// =====================
const API_BASE = "https://interactive-podcast.onrender.com"
async function ttsBackend(text) {
  const res = await fetch(`${API_BASE}/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`TTS error ${res.status}: ${txt}`);
  }

  const audioBlob = await res.blob(); // audio/mpeg
  return URL.createObjectURL(audioBlob);
}

async function askBackend(payload) {
  const res = await fetch(`${API_BASE}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Backend error ${res.status}: ${txt}`);
  }
  return res.json();
}

// =====================
// Overlay UI (hotkey toggled / icon toggled)
// =====================
const OVERLAY_ID = "ip-overlay-root";
let overlayOpen = false;

// Audio state: prefetch immediately, play only on button click
let currentAudio = null; // HTMLAudioElement
let currentAudioUrl = null; // blob URL
let currentTtsReady = false;

function cleanupAudio() {
  try {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
    }
    if (currentAudioUrl) {
      URL.revokeObjectURL(currentAudioUrl);
      currentAudioUrl = null;
    }
  } catch {}
  currentTtsReady = false;
}

function ensureOverlay() {
  if (document.getElementById(OVERLAY_ID)) return;

  const style = document.createElement("style");
  style.textContent = `
    #${OVERLAY_ID} {
      position: fixed;
      right: 16px;
      bottom: 92px;
      width: 380px;
      z-index: 999999;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;
      color: #eee;
    }
    #${OVERLAY_ID} .card {
      background: rgba(10,10,10,0.92);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 16px;
      box-shadow: 0 18px 50px rgba(0,0,0,0.55);
      overflow: hidden;
      backdrop-filter: blur(10px);
    }
    #${OVERLAY_ID} .head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
      padding: 12px 12px 8px 12px;
    }
    #${OVERLAY_ID} .title {
      font-weight: 800;
      font-size: 14px;
      line-height: 1.1;
    }
    #${OVERLAY_ID} .meta {
      margin-top: 4px;
      font-size: 11px;
      color: rgba(255,255,255,0.70);
      line-height: 1.25;
      word-break: break-word;
    }
    #${OVERLAY_ID} .x {
      border: none;
      background: rgba(255,255,255,0.10);
      color: #eee;
      width: 30px;
      height: 30px;
      border-radius: 999px;
      cursor: pointer;
    }
    #${OVERLAY_ID} .x:hover { background: rgba(255,255,255,0.16); }
    #${OVERLAY_ID} .body { padding: 10px 12px 12px 12px; }
    #${OVERLAY_ID} .row { display: flex; gap: 10px; flex-wrap: wrap; }
    #${OVERLAY_ID} .pill {
      font-size: 11px;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.10);
      color: rgba(255,255,255,0.82);
      white-space: nowrap;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    #${OVERLAY_ID} textarea {
      width: 100%;
      margin-top: 10px;
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.14);
      background: rgba(0,0,0,0.35);
      color: #eee;
      outline: none;
      font-size: 13px;
      resize: none;
    }
    #${OVERLAY_ID} textarea::placeholder {
      color: rgba(255,255,255,0.45);
    }
    #${OVERLAY_ID} .actions {
      margin-top: 10px;
      display: flex;
      gap: 10px;
      justify-content: flex-end;
      align-items: center;
    }
    #${OVERLAY_ID} .btn {
      border: none;
      border-radius: 12px;
      padding: 10px 12px;
      font-weight: 800;
      cursor: pointer;
      font-size: 13px;
    }
    #${OVERLAY_ID} .btn.primary {
      background: #1db954;
      color: #0b0b0b;
    }
    #${OVERLAY_ID} .btn.primary:hover { filter: brightness(1.05); }
    #${OVERLAY_ID} .btn.ghost {
      background: rgba(255,255,255,0.10);
      color: #eee;
    }
    #${OVERLAY_ID} .btn.ghost:hover { background: rgba(255,255,255,0.16); }
    #${OVERLAY_ID} .btn:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
    #${OVERLAY_ID} .hint {
      margin-top: 8px;
      font-size: 11px;
      color: rgba(255,255,255,0.55);
    }
    #${OVERLAY_ID} .answer {
      margin-top: 10px;
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(255,255,255,0.06);
      font-size: 13px;
      line-height: 1.35;
      white-space: pre-wrap;
    }
    #${OVERLAY_ID} .error {
      margin-top: 10px;
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid rgba(255,120,120,0.35);
      background: rgba(255,80,80,0.10);
      font-size: 12px;
      white-space: pre-wrap;
    }
    #${OVERLAY_ID} .loading {
      opacity: 0.7;
      pointer-events: none;
    }
    #${OVERLAY_ID} .audioStatus {
      margin-top: 8px;
      font-size: 11px;
      color: rgba(255,255,255,0.55);
    }
    #${OVERLAY_ID} audio {
      width: 100%;
      margin-top: 8px;
    }
  `;
  document.documentElement.appendChild(style);

  const root = document.createElement("div");
  root.id = OVERLAY_ID;
  root.style.display = "none";
  root.innerHTML = `
    <div class="card">
      <div class="head">
        <div>
          <div class="title">Ask about this moment</div>
          <div class="meta" id="ip-meta">Detecting…</div>
        </div>
        <button class="x" id="ip-close" aria-label="Close">✕</button>
      </div>

      <div class="body" id="ip-body">
        <div class="row">
          <div class="pill" id="ip-time">—</div>
          <div class="pill" id="ip-playing">—</div>
        </div>

        <textarea id="ip-q" rows="2" placeholder="e.g., What do you mean by that?"></textarea>

        <div class="actions">
          <button class="btn ghost" id="ip-clear">Clear</button>
          <button class="btn ghost" id="ip-play" disabled>Play</button>
          <button class="btn primary" id="ip-ask">Ask</button>
        </div>

        <div class="audioStatus" id="ip-audio-status"></div>
        <div id="ip-audio-controls"></div>

        <div class="hint">Hotkey: Ctrl/Cmd + Shift + Space · Sends last 2 min context (server-side)</div>

        <div id="ip-out"></div>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const closeBtn = root.querySelector("#ip-close");
  const clearBtn = root.querySelector("#ip-clear");
  const askBtn = root.querySelector("#ip-ask");
  const playBtn = root.querySelector("#ip-play");
  const qEl = root.querySelector("#ip-q");
  const outEl = root.querySelector("#ip-out");
  const body = root.querySelector("#ip-body");
  const audioStatusEl = root.querySelector("#ip-audio-status");
  const audioControlsEl = root.querySelector("#ip-audio-controls");

  function syncPlayLabel() {
    const a = root.querySelector("#ip-audio");
    if (!a) {
      playBtn.textContent = "Play";
      return;
    }
    playBtn.textContent = a.paused ? "Play" : "Pause";
  }

  closeBtn.addEventListener("click", () => setOverlayOpen(false));

  clearBtn.addEventListener("click", () => {
    qEl.value = "";
    qEl.focus();
  });

  // Play button now toggles play/pause on the <audio> element (if present)
  playBtn.addEventListener("click", () => {
    const a = root.querySelector("#ip-audio");
    if (!a || !currentTtsReady) return;

    if (a.paused) a.play().catch((e) => console.warn("play blocked:", e));
    else a.pause();

    syncPlayLabel();
  });

  askBtn.addEventListener("click", async () => {
    const q = qEl.value.trim();
    const s = lastState || {};

    const payload = {
      episodeId: s.episodeId || null,
      episodeUrl: s.episodeUrl || null,
      episodeTitle: s.episodeTitle || null,
      showName: s.showName || null,
      timestampSeconds: s.positionSeconds ?? null,
      question: q || null,
    };

    outEl.innerHTML = "";
    audioStatusEl.textContent = "";
    audioControlsEl.innerHTML = "";
    playBtn.disabled = true;
    playBtn.textContent = "Play";
    cleanupAudio();

    if (!payload.timestampSeconds && payload.timestampSeconds !== 0) {
      outEl.innerHTML = `<div class="error">Could not read playback timestamp yet. Try again in a second.</div>`;
      return;
    }
    if (!payload.question) {
      outEl.innerHTML = `<div class="error">Type a question first.</div>`;
      return;
    }

    body.classList.add("loading");

    const requestId = Date.now();
    askBtn.dataset.req = String(requestId);

    try {
      const resp = await askBackend(payload);
      if (askBtn.dataset.req !== String(requestId)) return;

      const answerText = resp?.answer ?? "(no answer returned)";
      outEl.innerHTML = `<div class="answer">${answerText}</div>`;

      // Prefetch TTS immediately, but do not play
      audioStatusEl.textContent = "Generating audio…";
      const audioUrl = await ttsBackend(answerText);
      if (askBtn.dataset.req !== String(requestId)) return;

      currentAudioUrl = audioUrl;
      currentAudio = new Audio(currentAudioUrl);
      currentTtsReady = true;

      // Render a real audio player with play/pause controls
      audioControlsEl.innerHTML = `
        <audio id="ip-audio" controls preload="auto">
          <source src="${currentAudioUrl}" type="audio/mpeg" />
        </audio>
      `;

      const a = root.querySelector("#ip-audio");
      a.addEventListener("play", syncPlayLabel);
      a.addEventListener("pause", syncPlayLabel);
      syncPlayLabel();

      playBtn.disabled = false;
      audioStatusEl.textContent = "Audio ready.";
    } catch (e) {
      console.error(e);
      outEl.innerHTML = `<div class="error">${String(e.message || e)}</div>`;
      audioStatusEl.textContent = "";
      audioControlsEl.innerHTML = "";
      playBtn.disabled = true;
      cleanupAudio();
    } finally {
      if (askBtn.dataset.req === String(requestId)) {
        body.classList.remove("loading");
      }
    }
  });

  qEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      askBtn.click();
    }
    if (e.key === "Escape") setOverlayOpen(false);
  });
}


function renderOverlay() {
  const root = document.getElementById(OVERLAY_ID);
  if (!root) return;

  const s = lastState || {};
  const metaEl = root.querySelector("#ip-meta");
  const timeEl = root.querySelector("#ip-time");
  const playingEl = root.querySelector("#ip-playing");

  const show = s.showName || "Unknown show";
  const ep = s.episodeTitle || "Unknown episode";
  const t = s.positionText
    ? `${s.positionText}${s.durationText ? ` / ${s.durationText}` : ""}`
    : "—";

  metaEl.textContent = `${show} · ${ep}`;
  timeEl.textContent = t;

  const p = s.isPlaying === true ? "Playing" : s.isPlaying === false ? "Paused" : "—";
  playingEl.textContent = p;
}

function setOverlayOpen(v) {
  ensureOverlay();
  overlayOpen = v;

  const root = document.getElementById(OVERLAY_ID);
  if (!root) return;

  root.style.display = overlayOpen ? "block" : "none";

  if (overlayOpen) {
    renderOverlay();
    const input = root.querySelector("#ip-q");
    input.focus();
  }
}

// Hotkey: Ctrl/Cmd + Shift + Space
window.addEventListener("keydown", (e) => {
  const combo = e.code === "Space" && e.shiftKey && (e.ctrlKey || e.metaKey);
  if (!combo) return;

  e.preventDefault();
  e.stopPropagation();
  setOverlayOpen(!overlayOpen);
});

// keep overlay live-updated while open
setInterval(() => {
  if (overlayOpen) renderOverlay();
}, 500);
