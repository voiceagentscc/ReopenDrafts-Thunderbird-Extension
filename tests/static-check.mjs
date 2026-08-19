import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.browser_specific_settings.gecko.strict_min_version, "153.0");
assert.equal(manifest.default_locale, "en");
assert.equal(manifest.name, "__MSG_extensionName__");
assert.ok(manifest.action?.default_popup);
assert.equal(manifest.action.default_icon["16"], "assets/icons/beer/beer-2-16.png");
assert.equal(manifest.icons["16"], "assets/icons/beer/beer-2-16.png");
assert.ok(manifest.options_ui?.page);
assert.deepEqual(manifest.action.allowed_spaces, ["mail"]);
assert.equal(manifest.action.default_label, "__MSG_extensionName__");
assert.ok(manifest.permissions.includes("storage"));
assert.ok(manifest.permissions.includes("compose"));
assert.ok(!manifest.permissions.includes("tabs"));
assert.ok(manifest.experiment_apis.existingDraft);

const background = await readFile("background.js", "utf8");
for (const pattern of [
  /compose\.onAfterSave\.addListener/,
  /compose\.onAfterSend\.addListener/,
  /messages\.onDeleted\.addListener/,
  /tabs\.onRemoved\.addListener/,
  /PRESERVE_ON_EXIT/,
  /headerMessageId/,
  /browserConsoleRestore/,
  /draftRestore/,
  /openDurableDraft/,
  /startup-restore-begin/,
  /appendLog/,
  /scanOpenComposeDrafts/,
  /compose\.onComposeStateChanged/,
  /compose-state-scan-failed/,
  /session-preserved-for-application-quit/,
  /toolbarVisible/,
  /toolbarIcon/,
  /applyToolbarIcon/,
  /logToFile/,
  /getDefaultLogFilePath/,
  /toolbar-hidden\.html/,
  /source === "toolbar"/,
  /restorePosition/,
  /restoreSize/,
  /clearActionBadge/,
  /ask-dialog-open-failed/,
  /stale-compose-associations-cleared/,
  /enqueueMutation/,
  /windows\.update/,
]) assert.match(background, pattern);

const implementation = await readFile("experiment/implementation.js", "utf8");
assert.match(implementation, /messageManager\.get\(messageId\)/);
assert.match(implementation, /Ci\.nsIMsgCompType\.Draft/);
assert.match(implementation, /getMainWindowIds/);
assert.match(implementation, /BrowserConsoleManager\.openBrowserConsoleOrFocus/);
assert.match(implementation, /FileUtils\.openFileOutputStream/);
assert.match(implementation, /listOpenComposeDrafts/);
assert.match(implementation, /quit-application-granted/);
assert.match(implementation, /getMsgHdrForMessageID/);
assert.match(implementation, /openDurableDraft/);
assert.match(implementation, /getDefaultLogFilePath/);
assert.match(implementation, /getFolder\(folderId\)\.folder/);
assert.doesNotMatch(implementation, /folder\.updateFolder/);
assert.doesNotMatch(implementation, /getFolderForURL\(folderId\)/);

const popup = await readFile("popup.html", "utf8");
assert.match(popup, /Reopen Drafts settings/);
assert.doesNotMatch(popup, /Open Browser Console/);
assert.doesNotMatch(popup, /Previously open drafts/);
assert.match(popup, /toolbar\.js/);
assert.match(popup, /Toolbar icon/);
assert.doesNotMatch(popup, /restore-position/);
const options = await readFile("options.html", "utf8");
assert.match(options, /<details class="debugging">/);
assert.match(options, /<summary>Debugging<\/summary>/);
assert.match(options, /Log to file/);
assert.match(options, /Drafts available to restore/);
assert.match(options, /Toolbar icon/);
const toolbarHidden = await readFile("toolbar-hidden.html", "utf8");
assert.match(toolbarHidden, /Oops! Keep it in the toolbar/);
for (const family of ["beer", "window"]) {
  for (const size of [16, 32, 48, 64, 98, 128]) {
    assert.ok((await readFile(`assets/icons/${family}/${family === "beer" ? "beer-2" : "wind-2"}-${size}.png`)).length > 0);
  }
}
assert.doesNotMatch(background, /setBadgeText\(\{ text: model\.count/);
assert.doesNotMatch(background, /messages\.query/);
assert.doesNotMatch(background, /removeEntries\(entry => entry\.windowId === windowId/);
assert.match(background, /Draft membership and main-window mode are event-driven/);
const ask = await readFile("ask.html", "utf8");
assert.match(ask, /Restore selected/);
assert.match(ask, /Restore all/);
const readme = await readFile("README.md", "utf8");
assert.doesNotMatch(readme, /Stage \d/);

console.log("Static extension checks passed.");
