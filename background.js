// Core logic: if the active tab is pinned, reset it back to its "home" URL
// (the URL it was on when it got pinned) and unload (discard) it, instead
// of closing it. Otherwise, fall back to normal behavior (closing the tab).
// In both cases, we then switch focus to the most recently accessed tab in
// the window (using tab.lastAccessed, provided natively by Chromium),
// skipping discarded tabs. If there's no candidate, we open a new tab.

// Home URLs are stored in chrome.storage.local (durable across restarts),
// keyed by origin rather than tab id: tab ids are reassigned on every
// browser restart, but a pinned tab's origin (e.g. https://www.youtube.com)
// stays the same, so this is what lets the reset survive "continue where
// you left off" bringing the tab back on whatever page it was last on.
// An in-memory cache avoids round-tripping to storage on every lookup; it's
// seeded on first access and kept in sync on writes.

let pinnedHomesCache = null;

async function loadPinnedHomes() {
  if (!pinnedHomesCache) {
    ({ pinnedHomes: pinnedHomesCache = {} } = await chrome.storage.local.get("pinnedHomes"));
  }
  return pinnedHomesCache;
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch (e) {
    return null;
  }
}

async function getHomeUrl(origin) {
  return (await loadPinnedHomes())[origin];
}

async function setHomeUrl(origin, url) {
  const pinnedHomes = await loadPinnedHomes();
  pinnedHomes[origin] = url;
  await chrome.storage.local.set({ pinnedHomes });
}

// chrome.tabs.update() resolves as soon as the navigation is *requested*,
// not once it has committed. Discarding right after would interrupt it
// mid-flight, leaving the tab's last committed URL unchanged. Wait for the
// URL to actually commit (or time out) before returning - no need to wait
// for the full page load, we just need the navigation to have stuck.
function navigateAndWait(tabId, url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve();
    };
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId) return;
      if (changeInfo.url === url || changeInfo.status === "complete") finish();
    };
    const timer = setTimeout(finish, timeoutMs);

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.update(tabId, { url }).catch(finish);
  });
}

// Navigate a pinned tab back to its recorded home URL (if any, and if not
// already there), then discard it. Shared by the manual unload path and
// the browser-startup cleanup.
async function resetAndDiscardPinnedTab(tab) {
  const origin = originOf(tab.url);
  const homeUrl = (origin && (await getHomeUrl(origin))) || tab.url;
  try {
    if (tab.url !== homeUrl) await navigateAndWait(tab.id, homeUrl);
    await chrome.tabs.discard(tab.id);
  } catch (e) {
    // Some tabs (chrome://, pages with unsaved form data, etc.) can't be
    // reset/discarded: do nothing more than we already did.
    console.warn("Could not reset/discard pinned tab:", e);
  }
}

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
    // Switch focus away first so the reset happens out of view.
    if (wasActive) await activateLastUsedOrCreate(windowId, tabId);
    await resetAndDiscardPinnedTab(tab);
    return;
  }

  try {
    await chrome.tabs.remove(tabId);
  } catch (e) {
    console.warn("Could not close tab:", e);
    return;
  }

  if (wasActive) await activateLastUsedOrCreate(windowId, tabId);
}

// 0) On browser startup, keep only pinned tabs from the restored session:
//    close every regular tab in each window, after opening a fresh empty
//    tab (set active) so the window always has something to land on. Also
//    reset every pinned tab to its home URL and discard it: Chrome eagerly
//    loads whichever tab was active when the browser was closed, before
//    this listener even runs, so without this it'd be the one tab left
//    loaded on whatever page it was last on instead of its home.
//    Windows are independent of each other, and so are the tabs within a
//    window once the replacement tab exists, so both run concurrently.
chrome.runtime.onStartup.addListener(async () => {
  const windows = await chrome.windows.getAll({ populate: true });

  await Promise.all(
    windows.map(async (win) => {
      const pinned = win.tabs.filter((t) => t.pinned);
      const unpinned = win.tabs.filter((t) => !t.pinned);

      try {
        await chrome.tabs.create({ windowId: win.id, active: true });
      } catch (e) {
        console.warn("Could not open a new tab:", e);
        return;
      }

      await Promise.all([
        ...unpinned.map((t) =>
          chrome.tabs.remove(t.id).catch((e) => console.warn("Could not close restored tab:", e))
        ),
        ...pinned.map((t) => resetAndDiscardPinnedTab(t))
      ]);
    })
  );
});

// 0b) Pinning a tab *is* the "this is home" action: record its URL as the
//     home for that origin. This always overwrites, so re-pinning a tab on
//     a different page redefines its home.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.pinned === true) {
    const origin = originOf(tab.url);
    if (origin) await setHomeUrl(origin, tab.url);
  }
});

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
  chrome.contextMenus.create({
    id: "set-pinned-home",
    title: "Set current page as this pinned tab's home",
    contexts: ["action"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "unload-pinned-tab") {
    await closeOrUnloadTab(tab);
  } else if (info.menuItemId === "set-pinned-home" && tab && tab.pinned) {
    const origin = originOf(tab.url);
    if (origin) await setHomeUrl(origin, tab.url);
  }
});

// Exposed for tests only (Node's CommonJS `module` doesn't exist in the
// browser's service worker, so this is a no-op there).
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    originOf,
    getHomeUrl,
    setHomeUrl,
    navigateAndWait,
    resetAndDiscardPinnedTab,
    activateLastUsedOrCreate,
    closeOrUnloadTab
  };
}
