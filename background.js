// Coeur de l'extension : si l'onglet actif est épinglé, on le décharge (discard)
// au lieu de le fermer. Sinon, comportement normal (fermeture).
// Dans les deux cas, on revient ensuite sur le dernier onglet actif de la
// fenêtre (en se basant sur tab.lastAccessed, fourni nativement par
// Chromium), en ignorant les onglets déchargés. S'il n'y a aucun candidat,
// on ouvre un nouvel onglet.

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
    console.warn("Impossible d'ouvrir un nouvel onglet :", e);
  }
}

async function closeOrUnloadTab(tab) {
  if (!tab || tab.id === undefined) return;

  const wasActive = tab.active;
  const windowId = tab.windowId;
  const tabId = tab.id;

  if (tab.pinned) {
    // Un onglet déjà déchargé n'a rien à faire de plus.
    if (tab.discarded) return;
    try {
      await chrome.tabs.discard(tabId);
    } catch (e) {
      // Certains onglets (chrome://, pages avec formulaire non sauvegardé, etc.)
      // ne peuvent pas être déchargés : on ne fait rien plutôt que de les fermer.
      console.warn("Impossible de décharger l'onglet épinglé :", e);
      return;
    }
  } else {
    try {
      await chrome.tabs.remove(tabId);
    } catch (e) {
      console.warn("Impossible de fermer l'onglet :", e);
      return;
    }
  }

  if (wasActive) {
    await activateLastUsedOrCreate(windowId, tabId);
  }
}

// 1) Raccourci clavier déclaré via chrome.commands (si Helium autorise la
//    réassignation de Ctrl+W dans chrome://extensions/shortcuts).
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "close-or-unload-tab") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await closeOrUnloadTab(tab);
});

// 2) Filet de sécurité : si un content script détecte Ctrl+W et arrive à
//    empêcher le comportement par défaut du navigateur, il nous le signale.
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message && message.type === "ctrl-w-pressed" && sender.tab) {
    closeOrUnloadTab(sender.tab);
  }
});

// 3) Action de la barre d'outils : décharger manuellement l'onglet épinglé actif.
chrome.action.onClicked.addListener(async (tab) => {
  await closeOrUnloadTab(tab);
});

// 4) Menu contextuel sur les onglets épinglés.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "unload-pinned-tab",
    title: "Décharger cet onglet épinglé",
    contexts: ["action"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "unload-pinned-tab") {
    await closeOrUnloadTab(tab);
  }
});
