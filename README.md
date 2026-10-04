# Pinned Tab Unloader

A browser extension for Helium (and other Chromium-based browsers) that
replicates Arc's behavior for pinned tabs: pressing Ctrl+W on a pinned tab
unloads it from memory instead of closing/unpinning it. The tab stays pinned
and resets back to its "home" URL — the URL it had when you pinned it — so
it's always back where you started next time you click it, no matter where
you navigated to in the meantime.

## Features

- Pinned tab + Ctrl+W → resets to its home URL and unloads (discard), not
  close. E.g. pin the YouTube homepage, watch a few videos, Ctrl+W: it's
  back to the homepage, not the last video
- Regular tab + Ctrl+W → closes as usual
- After closing/unloading the active tab, focus switches to the most
  recently used tab in the window (skipping discarded tabs), or opens a new
  tab if none is available
- Toolbar button and context menu to manually unload a pinned tab
- Context menu entry to (re)set a pinned tab's home URL to whatever page
  it's currently on, in case it was never recorded or needs to change
- On browser startup, automatically closes any restored regular tab,
  keeping only pinned tabs, and opens a new empty active tab to land on
  (see below)

## Install

1. Open `helium://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this folder
4. Go to `helium://extensions/shortcuts` and assign **Ctrl+W** to this
   extension's "Close the tab, or unload it if it's pinned" command
5. Go to `helium://settings/onStartup` and select **Continue where you left
   off** — this makes Helium restore pinned tabs across restarts; the
   extension then closes any other restored tab on startup, so only pinned
   tabs survive

## Note

Chromium browsers often handle Ctrl+W at the browser-process level, before
extensions can intercept it. If Helium won't let you reassign Ctrl+W in
`helium://extensions/shortcuts`, use the toolbar button/context menu instead,
or pick an alternate shortcut (e.g. Ctrl+Shift+W).

A pinned tab's home URL is recorded the moment you pin it, keyed by origin
(e.g. `https://www.youtube.com`) rather than by tab, so it survives browser
restarts even with "continue where you left off" bringing the tab back on
whatever page it was last on. If a tab was already pinned before this was
added (or the home is ever wrong), use the toolbar icon's right-click menu →
**Set current page as this pinned tab's home** while on the page you want,
to (re)record it.
