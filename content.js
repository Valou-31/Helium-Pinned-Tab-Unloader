// Safety net: attempts to intercept Ctrl+W at the page level.
// Note: most Chromium-based browsers handle Ctrl+W at the browser process
// level, so preventDefault() here won't always block the close. The real
// fix is the "commands" shortcut in background.js, configurable via
// helium://extensions/shortcuts.
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
      // extension context invalidated (extension reload): ignore
    }
  },
  { capture: true }
);
