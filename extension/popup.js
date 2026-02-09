async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }
  
  function setText(id, txt) {
    document.getElementById(id).textContent = txt ?? "—";
  }
  
  async function refresh() {
    const tab = await getActiveTab();
    if (!tab?.id || !tab.url?.includes("open.spotify.com")) {
      setText("episodeTitle", "Open Spotify Web Player");
      setText("episodeUrl", "—");
      setText("time", "—");
      setText("playing", "—");
      return;
    }
  
    chrome.tabs.sendMessage(tab.id, { type: "GET_SPOTIFY_STATE" }, (resp) => {
      if (!resp?.ok) {
        setText("episodeTitle", "No data yet (press Refresh again)");
        setText("episodeUrl", "—");
        setText("time", "—");
        setText("playing", "—");
        return;
      }
  
      const s = resp.state || {};
      setText("episodeTitle", s.episodeTitle || "(unknown episode)");
      setText("episodeUrl", s.showName || "(unknown show)");
  
      const t = s.positionText && s.durationText
        ? `${s.positionText} / ${s.durationText}`
        : (s.positionText || "—");
  
      setText("time", t);
  
      const p = (s.isPlaying === true) ? "Yes" : (s.isPlaying === false) ? "No" : "—";
      setText("playing", p);
    });
  }
  
  document.getElementById("refresh").addEventListener("click", refresh);
  refresh();
  