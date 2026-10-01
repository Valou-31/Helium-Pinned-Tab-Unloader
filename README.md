# Pinned Tab Unloader

A browser extension for Helium (and other Chromium-based browsers) that
replicates Arc's behavior for pinned tabs: pressing Ctrl+W on a pinned tab
unloads it from memory instead of closing/unpinning it. The tab stays pinned
with its URL intact and reloads next time you click it.

## Features

- Pinned tab + Ctrl+W → discard (unload), not close
- Regular tab + Ctrl+W → closes as usual
- After closing/unloading the active tab, focus switches to the most
  recently used tab in the window (skipping discarded tabs), or opens a new
  tab if none is available
- Toolbar button and context menu to manually unload a pinned tab

## Install

1. Open `helium://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this folder
4. Go to `helium://extensions/shortcuts` and assign **Ctrl+W** to this
   extension's "Close the tab, or unload it if it's pinned" command

## Note

Chromium browsers often handle Ctrl+W at the browser-process level, before
extensions can intercept it. If Helium won't let you reassign Ctrl+W in
`helium://extensions/shortcuts`, use the toolbar button/context menu instead,
or pick an alternate shortcut (e.g. Ctrl+Shift+W).
