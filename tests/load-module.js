// background.js/content.js are classic (non-module) scripts that expect a
// global `chrome` (and, for content.js, `window`) to already exist, and
// they keep a bit of module-level state (e.g. background.js's home-URL
// cache). Each test needs its own clean instance, so this bypasses
// require()'s module cache on every load.

function loadFresh(relativePath, globals = {}) {
  for (const [key, value] of Object.entries(globals)) {
    global[key] = value;
  }
  const modPath = require.resolve(relativePath);
  delete require.cache[modPath];
  return require(modPath);
}

module.exports = { loadFresh };
