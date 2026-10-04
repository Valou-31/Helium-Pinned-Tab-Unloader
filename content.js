// Safety net: attempts to intercept Ctrl+W at the page level.
// Note: most Chromium-based browsers handle Ctrl+W at the browser process
// level, so preventDefault() here won't always block the close. The real
// fix is the "commands" shortcut in background.js, configurable via
// helium://extensions/shortcuts.

function isCtrlW(event) {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.shiftKey &&
    !event.altKey &&
    (event.key === "w" || event.key === "W")
  );
}

window.addEventListener(
  "keydown",
  (event) => {
    if (!isCtrlW(event)) return;

    try {
      chrome.runtime.sendMessage({ type: "ctrl-w-pressed" });
    } catch (e) {
      // extension context invalidated (extension reload): ignore
    }
  },
  { capture: true }
);

// Exposed for tests only (Node's CommonJS `module` doesn't exist in the
// browser's content-script context, so this is a no-op there).
if (typeof module !== "undefined" && module.exports) {
  module.exports = { isCtrlW };
}
