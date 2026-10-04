const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createChromeMock } = require("./chrome-mock");
const { loadFresh } = require("./load-module");

function setup() {
  const { chrome, state } = createChromeMock();
  const background = loadFresh("../background.js", { chrome });
  return { chrome, state, background };
}

function addTab(state, overrides = {}) {
  const id = overrides.id ?? state.nextTabId++;
  const tab = {
    id,
    windowId: 1,
    url: "https://example.com/",
    pinned: false,
    active: false,
    discarded: false,
    lastAccessed: Date.now(),
    ...overrides
  };
  state.tabs.set(id, tab);
  return tab;
}

describe("originOf", () => {
  it("returns the origin for a normal URL", () => {
    const { background } = setup();
    assert.equal(background.originOf("https://www.youtube.com/watch?v=xyz"), "https://www.youtube.com");
  });

  it("returns null for an unparsable URL", () => {
    const { background } = setup();
    assert.equal(background.originOf(undefined), null);
    assert.equal(background.originOf("not a url"), null);
  });
});

describe("getHomeUrl / setHomeUrl", () => {
  it("round-trips a value through storage", async () => {
    const { background } = setup();
    await background.setHomeUrl("https://www.youtube.com", "https://www.youtube.com/");
    assert.equal(await background.getHomeUrl("https://www.youtube.com"), "https://www.youtube.com/");
  });

  it("caches storage reads instead of re-fetching every call", async () => {
    const { background, state } = setup();
    await background.setHomeUrl("https://x.com", "https://x.com/home");
    await background.getHomeUrl("https://x.com");
    await background.getHomeUrl("https://x.com");
    const storageReads = state.callLog.filter((c) => c.type === "storage.get");
    assert.equal(storageReads.length, 1);
  });
});

describe("resetAndDiscardPinnedTab", () => {
  it("just discards when the tab is already at its home URL", async () => {
    const { background, state, chrome } = setup();
    const tab = addTab(state, { url: "https://www.youtube.com/", pinned: true });
    await background.setHomeUrl("https://www.youtube.com", "https://www.youtube.com/");

    await background.resetAndDiscardPinnedTab(tab);

    assert.equal(state.callLog.some((c) => c.type === "update"), false);
    assert.equal(state.tabs.get(tab.id).discarded, true);
  });

  it("navigates back to the home URL before discarding", async () => {
    const { background, state } = setup();
    const tab = addTab(state, { url: "https://www.youtube.com/watch?v=xyz", pinned: true });
    await background.setHomeUrl("https://www.youtube.com", "https://www.youtube.com/");

    await background.resetAndDiscardPinnedTab(tab);

    const finalTab = state.tabs.get(tab.id);
    assert.equal(finalTab.url, "https://www.youtube.com/");
    assert.equal(finalTab.discarded, true);

    const updateIndex = state.callLog.findIndex((c) => c.type === "update");
    const discardIndex = state.callLog.findIndex((c) => c.type === "discard");
    assert.ok(updateIndex >= 0 && discardIndex > updateIndex, "update must happen before discard");
  });

  it("falls back to the tab's current URL when no home is recorded", async () => {
    const { background, state } = setup();
    const tab = addTab(state, { url: "https://example.com/page", pinned: true });

    await background.resetAndDiscardPinnedTab(tab);

    assert.equal(state.tabs.get(tab.id).url, "https://example.com/page");
    assert.equal(state.callLog.some((c) => c.type === "update"), false);
  });

  it("swallows errors from a tab that can't be discarded", async () => {
    const { background, state, chrome } = setup();
    const tab = addTab(state, { url: "https://example.com/", pinned: true });
    chrome.tabs.discard = async () => {
      throw new Error("cannot discard chrome:// or unsaved-form tabs");
    };

    await assert.doesNotReject(background.resetAndDiscardPinnedTab(tab));
  });

  it("regression: discarding before the navigation commits loses the reset (documents the bug this fixes)", async () => {
    // This talks to the mock's raw chrome.tabs API directly, bypassing
    // navigateAndWait, to prove the mock reproduces the real race condition
    // that resetAndDiscardPinnedTab (tested above) guards against.
    const { chrome, state } = createChromeMock();
    const tab = addTab(state, { url: "https://www.youtube.com/watch?v=xyz", pinned: true });

    await chrome.tabs.update(tab.id, { url: "https://www.youtube.com/" });
    await chrome.tabs.discard(tab.id); // no wait for the commit event, like the old buggy code

    assert.equal(state.tabs.get(tab.id).url, "https://www.youtube.com/watch?v=xyz");
  });
});

describe("activateLastUsedOrCreate", () => {
  it("activates the most recently accessed other tab in the window", async () => {
    const { background, state } = setup();
    addTab(state, { id: 1, windowId: 1, lastAccessed: 100 });
    const target = addTab(state, { id: 2, windowId: 1, lastAccessed: 300 });
    addTab(state, { id: 3, windowId: 1, lastAccessed: 200 });

    await background.activateLastUsedOrCreate(1, 1);

    assert.equal(state.tabs.get(target.id).active, true);
  });

  it("skips discarded tabs when picking a candidate", async () => {
    const { background, state } = setup();
    addTab(state, { id: 1, windowId: 1, lastAccessed: 300, discarded: true });
    const target = addTab(state, { id: 2, windowId: 1, lastAccessed: 100, discarded: false });

    await background.activateLastUsedOrCreate(1, 999);

    assert.equal(state.tabs.get(target.id).active, true);
  });

  it("creates a new tab when there are no candidates", async () => {
    const { background, state } = setup();
    addTab(state, { id: 1, windowId: 1 });

    await background.activateLastUsedOrCreate(1, 1);

    const created = state.callLog.filter((c) => c.type === "create");
    assert.equal(created.length, 1);
  });
});

describe("closeOrUnloadTab", () => {
  it("resets and discards a pinned tab, switching focus away first", async () => {
    const { background, state } = setup();
    const other = addTab(state, { id: 1, windowId: 1, lastAccessed: 50 });
    const pinned = addTab(state, {
      id: 2,
      windowId: 1,
      pinned: true,
      active: true,
      url: "https://www.youtube.com/watch?v=xyz"
    });
    await background.setHomeUrl("https://www.youtube.com", "https://www.youtube.com/");

    await background.closeOrUnloadTab(pinned);

    assert.equal(state.tabs.get(other.id).active, true);
    assert.equal(state.tabs.get(pinned.id).discarded, true);
    assert.equal(state.tabs.get(pinned.id).url, "https://www.youtube.com/");
  });

  it("closes a non-pinned tab instead of discarding it", async () => {
    const { background, state } = setup();
    const tab = addTab(state, { id: 1, windowId: 1, pinned: false });

    await background.closeOrUnloadTab(tab);

    assert.equal(state.tabs.has(tab.id), false);
  });

  it("switches focus after closing an active non-pinned tab", async () => {
    const { background, state } = setup();
    const other = addTab(state, { id: 1, windowId: 1, lastAccessed: 50 });
    const active = addTab(state, { id: 2, windowId: 1, active: true });

    await background.closeOrUnloadTab(active);

    assert.equal(state.tabs.get(other.id).active, true);
  });

  it("is a no-op for a missing tab", async () => {
    const { background, state } = setup();
    await assert.doesNotReject(background.closeOrUnloadTab(undefined));
    assert.equal(state.callLog.length, 0);
  });
});

describe("onStartup", () => {
  it("keeps only pinned tabs, resets them to home, and opens a fresh active tab", async () => {
    const { chrome, state } = createChromeMock();
    addTab(state, { id: 1, windowId: 1, pinned: false, url: "https://news.example/" });
    const pinned = addTab(state, {
      id: 2,
      windowId: 1,
      pinned: true,
      url: "https://www.youtube.com/watch?v=xyz" // last page before shutdown
    });
    state.nextTabId = 3;

    loadFresh("../background.js", { chrome });
    await chrome.storage.local.set({
      pinnedHomes: { "https://www.youtube.com": "https://www.youtube.com/" }
    });

    await chrome.runtime.onStartup._fire();

    const remaining = [...state.tabs.values()];
    assert.equal(remaining.some((t) => t.id === 1), false, "unpinned tab should be closed");

    const newTab = remaining.find((t) => t.id !== pinned.id);
    assert.ok(newTab, "a replacement tab should have been created");
    assert.equal(newTab.active, true);

    const finalPinned = state.tabs.get(pinned.id);
    assert.equal(finalPinned.discarded, true);
    assert.equal(finalPinned.url, "https://www.youtube.com/");
  });

  it("handles multiple windows independently", async () => {
    const { chrome, state } = createChromeMock();
    addTab(state, { id: 1, windowId: 1, pinned: true, url: "https://a.example/" });
    addTab(state, { id: 2, windowId: 2, pinned: true, url: "https://b.example/" });
    state.nextTabId = 3;

    loadFresh("../background.js", { chrome });
    await chrome.runtime.onStartup._fire();

    const windowIds = new Set([...state.tabs.values()].map((t) => t.windowId));
    assert.deepEqual(windowIds, new Set([1, 2]));
    assert.equal(state.tabs.get(1).discarded, true);
    assert.equal(state.tabs.get(2).discarded, true);
  });
});

describe("pin-tracking listener", () => {
  it("records the current URL as home when a tab becomes pinned", async () => {
    const { background, chrome, state } = setup();
    const tab = addTab(state, { id: 1, pinned: true, url: "https://mail.example/inbox" });

    await chrome.tabs.onUpdated._fire(tab.id, { pinned: true }, tab);

    assert.equal(await background.getHomeUrl("https://mail.example"), "https://mail.example/inbox");
  });

  it("does not touch the recorded home on an ordinary navigation", async () => {
    const { background, chrome, state } = setup();
    const tab = addTab(state, { id: 1, pinned: true, url: "https://mail.example/inbox" });
    await background.setHomeUrl("https://mail.example", "https://mail.example/inbox");

    await chrome.tabs.onUpdated._fire(tab.id, { url: "https://mail.example/thread/42" }, {
      ...tab,
      url: "https://mail.example/thread/42"
    });

    assert.equal(await background.getHomeUrl("https://mail.example"), "https://mail.example/inbox");
  });
});

describe("context menu", () => {
  it("'set-pinned-home' overwrites the recorded home with the current page", async () => {
    const { background, chrome, state } = setup();
    const tab = addTab(state, { id: 1, pinned: true, url: "https://mail.example/inbox" });
    await background.setHomeUrl("https://mail.example", "https://mail.example/old-home");

    await chrome.contextMenus.onClicked._fire({ menuItemId: "set-pinned-home" }, tab);

    assert.equal(await background.getHomeUrl("https://mail.example"), "https://mail.example/inbox");
  });

  it("'unload-pinned-tab' runs the same reset-and-discard path as a manual unload", async () => {
    const { chrome, state } = createChromeMock();
    const tab = addTab(state, { id: 1, pinned: true, url: "https://www.youtube.com/watch?v=xyz" });
    loadFresh("../background.js", { chrome });
    await chrome.storage.local.set({
      pinnedHomes: { "https://www.youtube.com": "https://www.youtube.com/" }
    });

    await chrome.contextMenus.onClicked._fire({ menuItemId: "unload-pinned-tab" }, tab);

    const finalTab = state.tabs.get(tab.id);
    assert.equal(finalTab.discarded, true);
    assert.equal(finalTab.url, "https://www.youtube.com/");
  });
});
