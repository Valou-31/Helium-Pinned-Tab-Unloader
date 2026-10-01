// Filet de sécurité : tente d'intercepter Ctrl+W au niveau de la page.
// Note : la plupart des navigateurs basés sur Chromium gèrent Ctrl+W au
// niveau du processus navigateur, donc preventDefault() ici ne bloquera pas
// toujours la fermeture. La vraie solution est le raccourci "commands" dans
// background.js, configurable via helium://extensions/shortcuts.
window.addEventListener(
  "keydown",
  (event) => {
    const isCtrlW =
      (event.ctrlKey || event.metaKey) &&
      !event.shiftKey &&
      !event.altKey &&
      (event.key === "w" || event.key === "W");

    if (!isCtrlW) return;

    try {
      chrome.runtime.sendMessage({ type: "ctrl-w-pressed" });
    } catch (e) {
      // contexte d'extension invalidé (rechargement de l'extension) : ignorer
    }
  },
  { capture: true }
);
