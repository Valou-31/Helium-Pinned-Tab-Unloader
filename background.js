// Core logic: if the active tab is pinned, unload (discard) it instead of
// closing it. Otherwise, fall back to normal behavior (closing the tab).
// In both cases, we then switch focus to the most recently accessed tab in
// the window (using tab.lastAccessed, provided natively by Chromium),
// skipping discarded tabs. If there's no candidate, we open a new tab.

async function activateLastUsedOrCreate(windowId, excludeTabId) {
  const tabs = await chrome.tabs.query({ windowId });

  const candidates = tabs
    .filter((t) => t.id !== excludeTabId && !t.discarded)
    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));

  if (candidates.length > 0) {
    await chrome.tabs.update(candidates[0].id, { active: true });
    return;
  }

  try {
    await chrome.tabs.create({ windowId });
  } catch (e) {
    console.warn("Could not open a new tab:", e);
  }
}

async function closeOrUnloadTab(tab) {
  if (!tab || tab.id === undefined) return;

  const wasActive = tab.active;
  const windowId = tab.windowId;
  const tabId = tab.id;

  if (tab.pinned) {
    // An already-discarded tab has nothing left to do.
    if (tab.discarded) return;
    try {
      await chrome.tabs.discard(tabId);
    } catch (e) {
      // Some tabs (chrome://, pages with unsaved form data, etc.) can't be
      // discarded: do nothing rather than closing them.
      console.warn("Could not discard pinned tab:", e);
      return;
    }
  } else {
    try {
      await chrome.tabs.remove(tabId);
    } catch (e) {
      console.warn("Could not close tab:", e);
      return;
    }
  }

  if (wasActive) {
    await activateLastUsedOrCreate(windowId, tabId);
  }
}

// 1) Keyboard shortcut declared via chrome.commands (if Helium allows
//    reassigning Ctrl+W in chrome://extensions/shortcuts).
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "close-or-unload-tab") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await closeOrUnloadTab(tab);
});

// 2) Safety net: if a content script detects Ctrl+W and manages to prevent
//    the browser's default behavior, it notifies us.
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message && message.type === "ctrl-w-pressed" && sender.tab) {
    closeOrUnloadTab(sender.tab);
  }
});

// 3) Toolbar action: manually unload the active pinned tab.
chrome.action.onClicked.addListener(async (tab) => {
  await closeOrUnloadTab(tab);
});

// 4) Context menu on pinned tabs.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "unload-pinned-tab",
    title: "Unload this pinned tab",
    contexts: ["action"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "unload-pinned-tab") {
    await closeOrUnloadTab(tab);
  }
});
