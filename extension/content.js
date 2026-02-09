// extension/content.js

let lastState = null;

function parseTimeToSeconds(mmss) {
  // Accepts "1:23" or "01:23" or "1:02:03"
  if (!mmss || typeof mmss !== "string") return null;
  const parts = mmss.split(":").map(p => p.trim());
  if (parts.some(p => p === "" || isNaN(Number(p)))) return null;

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

function getEpisodeInfoFromDOM() {
    // Episode anchor
    const a = document.querySelector('a[href*="/episode/"]');
    let episodeUrl = null;
    let episodeId = null;
    let episodeTitle = null;
  
    if (a) {
      const href = a.getAttribute("href");
      episodeUrl = href?.startsWith("http")
        ? href
        : (href ? `https://open.spotify.com${href}` : null);
  
      const match = href?.match(/\/episode\/([a-zA-Z0-9]+)/);
      episodeId = match ? match[1] : null;
  
      episodeTitle = (a.getAttribute("aria-label") || a.textContent || "").trim() || null;
    }
  
    // Show / podcast name
    // Try to find a /show/ link close to the now playing bar first (best accuracy)
    let showName = null;
  
    const nowPlayingBar =
      document.querySelector('[data-testid="now-playing-bar"]') ||
      document.querySelector('footer') ||
      document.querySelector('[role="contentinfo"]');
  
    const showA =
      nowPlayingBar?.querySelector('a[href*="/show/"]') ||
      (a ? a.closest('footer, [data-testid="now-playing-bar"], [role="contentinfo"]')?.querySelector('a[href*="/show/"]') : null) ||
      document.querySelector('a[href*="/show/"]');
  
    if (showA) {
      showName = (showA.getAttribute("aria-label") || showA.textContent || "").trim() || null;
    }
  
    // Fallback: MediaSession metadata (sometimes provides show/artist)
    if (!showName && navigator.mediaSession?.metadata) {
      const md = navigator.mediaSession.metadata;
      // For podcasts, Spotify often sets "artist" to show name
      showName = (md.artist || md.album || "").trim() || null;
    }
  
    return { episodeUrl, episodeId, episodeTitle, showName };
}
  

function getPlaybackTimeFromDOM() {
  // Spotify often uses these testids
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
  // Spotify play/pause button often has aria-label: "Play" or "Pause"
  const btn =
    document.querySelector('button[aria-label="Pause"]') ||
    document.querySelector('button[aria-label="Play"]') ||
    document.querySelector('button[data-testid="control-button-playpause"]') ||
    null;

  const aria = btn?.getAttribute("aria-label") || "";
  // If aria-label isn't Play/Pause, infer by presence of a Pause button
  const isPlaying = aria === "Pause" ? true : aria === "Play" ? false : null;

  return { isPlaying };
}

function buildState() {
  const ep = getEpisodeInfoFromDOM();
  const time = getPlaybackTimeFromDOM();
  const play = getPlayStateFromDOM();

  return {
    source: "spotify_web",
    detectedAtMs: Date.now(),
    ...ep,
    ...time,
    ...play
  };
}

function stateChanged(a, b) {
  if (!a) return true;
  // Only compare meaningful fields (not timestamp)
  const keys = [
    "episodeId",
    "episodeUrl",
    "episodeTitle",
    "positionSeconds",
    "positionText",
    "durationSeconds",
    "durationText",
    "isPlaying"
  ];
  return keys.some(k => a[k] !== b[k]);
}

function poll() {
  const s = buildState();

  // Only consider "valid" if we found an episode + a position
  const isValid = !!s.episodeId && s.positionSeconds != null;

  if (isValid && stateChanged(lastState, s)) {
    lastState = s;
    console.log("[InteractivePodcast] state:", s);
  } else if (!lastState) {
    // If first run has no state yet, keep lastState as whatever we have
    lastState = s;
  }
}

setInterval(poll, 750);
poll();

// Respond to popup requests
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "GET_SPOTIFY_STATE") {
    sendResponse({ ok: true, state: lastState });
    return true;
  }
});
