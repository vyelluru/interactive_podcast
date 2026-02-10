// extension/background.js

async function ensureContentScript(tabId) {
    try {
      // Try pinging the content script first
      await chrome.tabs.sendMessage(tabId, { type: "PING" });
      return true;
    } catch (e) {
      // If it fails, try injecting content.js (covers cases where tab loaded before install/reload)
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ["content.js"],
        });
        return true;
      } catch (err) {
        console.warn("Failed to inject content script:", err);
        return false;
      }
    }
  }
  
  chrome.action.onClicked.addListener(async (tab) => {
    if (!tab?.id || !tab.url?.includes("open.spotify.com")) return;
  
    const ok = await ensureContentScript(tab.id);
    if (!ok) return;
  
    chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_OVERLAY" });
  });
  