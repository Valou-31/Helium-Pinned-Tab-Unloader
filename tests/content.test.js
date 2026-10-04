const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { loadFresh } = require("./load-module");

function load() {
  return loadFresh("../content.js", {
    window: { addEventListener() {} },
    chrome: { runtime: { sendMessage() {} } }
  });
}

function keyEvent(overrides = {}) {
  return {
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    key: "",
    ...overrides
  };
}

describe("isCtrlW", () => {
  it("matches plain Ctrl+W", () => {
    const { isCtrlW } = load();
    assert.equal(isCtrlW(keyEvent({ ctrlKey: true, key: "w" })), true);
  });

  it("matches Cmd+W (metaKey) for mac-style bindings, and is case-insensitive", () => {
    const { isCtrlW } = load();
    assert.equal(isCtrlW(keyEvent({ metaKey: true, key: "W" })), true);
  });

  it("rejects Ctrl+Shift+W and Ctrl+Alt+W", () => {
    const { isCtrlW } = load();
    assert.equal(isCtrlW(keyEvent({ ctrlKey: true, shiftKey: true, key: "w" })), false);
    assert.equal(isCtrlW(keyEvent({ ctrlKey: true, altKey: true, key: "w" })), false);
  });

  it("rejects other keys and plain W without a modifier", () => {
    const { isCtrlW } = load();
    assert.equal(isCtrlW(keyEvent({ ctrlKey: true, key: "t" })), false);
    assert.equal(isCtrlW(keyEvent({ key: "w" })), false);
  });
});
