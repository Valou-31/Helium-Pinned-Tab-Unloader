// Minimal hand-rolled mock of the slice of the chrome.* extension APIs that
// background.js and content.js actually use. No external dependencies, so
// this project stays zero-build/zero-install (see README).
//
// tabs.update() deliberately resolves *before* the navigation "commits":
// the commit (the chrome.tabs.onUpdated event) fires on a separate tick,
// and is skipped entirely if the tab gets discarded or removed first. This
// mirrors real Chromium's behavior closely enough to catch the exact race
// condition background.js has to guard against (discarding a tab while its
// navigation is still in flight silently drops the navigation).

function createEventMock() {
  const listeners = new Set();
  return {
    addListener(fn) {
      listeners.add(fn);
    },
    removeListener(fn) {
      listeners.delete(fn);
    },
    listenerCount() {
      return listeners.size;
    },
    async _fire(...args) {
      await Promise.all([...listeners].map((fn) => fn(...args)));
    }
  };
}

function createChromeMock() {
  const state = {
    tabs: new Map(),
    nextTabId: 1,
    storageLocal: {},
    callLog: []
  };

  function requireTab(tabId) {
    const tab = state.tabs.get(tabId);
    if (!tab) throw new Error(`No tab with id: ${tabId}`);
    return tab;
  }

  const chrome = {
    runtime: {
      onStartup: createEventMock(),
      onInstalled: createEventMock(),
      onMessage: createEventMock()
    },

    tabs: {
      onUpdated: createEventMock(),

      async query(queryInfo = {}) {
        return [...state.tabs.values()].filter((t) => {
          if (queryInfo.windowId !== undefined && t.windowId !== queryInfo.windowId) return false;
          if (queryInfo.active !== undefined && t.active !== queryInfo.active) return false;
          if (queryInfo.pinned !== undefined && t.pinned !== queryInfo.pinned) return false;
          return true;
        });
      },

      async create(props = {}) {
        const tab = {
          id: state.nextTabId++,
          windowId: props.windowId ?? 1,
          url: props.url ?? "chrome://newtab/",
          pinned: false,
          active: props.active ?? true,
          discarded: false,
          lastAccessed: Date.now()
        };
        state.tabs.set(tab.id, tab);
        state.callLog.push({ type: "create", tabId: tab.id });
        return { ...tab };
      },

      async remove(tabId) {
        requireTab(tabId);
        state.tabs.delete(tabId);
        state.callLog.push({ type: "remove", tabId });
      },

      async update(tabId, props = {}) {
        const tab = requireTab(tabId);
        if (props.active !== undefined) tab.active = props.active;

        if (props.url !== undefined) {
          const newUrl = props.url;
          state.callLog.push({ type: "update", tabId, url: newUrl });
          setTimeout(() => {
            const stillThere = state.tabs.get(tabId);
            if (!stillThere || stillThere.discarded) return; // navigation lost the race
            stillThere.url = newUrl;
            chrome.tabs.onUpdated._fire(tabId, { url: newUrl, status: "complete" }, { ...stillThere });
          }, 0);
        }

        return { ...tab };
      },

      async discard(tabId) {
        const tab = requireTab(tabId);
        tab.discarded = true;
        state.callLog.push({ type: "discard", tabId });
        return { ...tab };
      }
    },

    windows: {
      async getAll(/* options */) {
        const byWindow = new Map();
        for (const tab of state.tabs.values()) {
          if (!byWindow.has(tab.windowId)) byWindow.set(tab.windowId, []);
          byWindow.get(tab.windowId).push({ ...tab });
        }
        return [...byWindow.entries()].map(([id, tabs]) => ({ id, tabs }));
      }
    },

    storage: {
      local: {
        async get(key) {
          state.callLog.push({ type: "storage.get", key });
          return { [key]: state.storageLocal[key] };
        },
        async set(obj) {
          Object.assign(state.storageLocal, obj);
        }
      }
    },

    commands: { onCommand: createEventMock() },
    action: { onClicked: createEventMock() },
    contextMenus: { create() {}, onClicked: createEventMock() }
  };

  return { chrome, state };
}

module.exports = { createChromeMock };
