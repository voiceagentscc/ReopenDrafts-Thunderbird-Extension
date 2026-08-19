/* global browser */

import {
  composeGeometryRestoreUpdate,
  durableDraftIdentityKey,
  entryKey,
  isDeletedDraftKey,
  lifecycleDisposition,
  nextSessionMode,
  removeDeletedDraftEntries,
  removeDraftEntries,
  restoreDisposition,
  shouldPreserveComposeClose,
  upsertDraftEntry,
  withDeletedDraftKeys,
} from "./session-state.js";

const STATE_KEY = "composeSessionState";
const LEGACY_RECORD_KEY = "stage1Draft";
const DEFAULT_LOG_FILE_PATH = "/tmp/reopen-drafts.log";
const DEFAULT_SETTINGS = Object.freeze({
  browserConsoleRestore: "never",
  draftRestore: "always",
  preserveOnMainClose: true,
  toolbarVisible: true,
  toolbarIcon: "beer",
  restorePosition: true,
  restoreSize: true,
  logToFile: true,
  logFilePath: DEFAULT_LOG_FILE_PATH,
});

const TOOLBAR_ICON_PATHS = Object.freeze({
  beer: {
    16: "assets/icons/beer/beer-2-16.png", 32: "assets/icons/beer/beer-2-32.png",
    48: "assets/icons/beer/beer-2-48.png", 64: "assets/icons/beer/beer-2-64.png",
    98: "assets/icons/beer/beer-2-98.png", 128: "assets/icons/beer/beer-2-128.png",
  },
  window: {
    16: "assets/icons/window/wind-2-16.png", 32: "assets/icons/window/wind-2-32.png",
    48: "assets/icons/window/wind-2-48.png", 64: "assets/icons/window/wind-2-64.png",
    98: "assets/icons/window/wind-2-98.png", 128: "assets/icons/window/wind-2-128.png",
  },
});

let state;
let startupRestoreStarted = false;
let observingCurrentSession = false;
let mutationTail = Promise.resolve();

function log(event, data = {}) {
  // Diagnostics deliberately omit message content, recipients, and attachments.
  const prefix = `[reopen-drafts] ${event}`;
  console.info(prefix, data);
  const line = `${new Date().toISOString()} ${prefix} ${JSON.stringify(data)}\n`;
  if (state?.settings?.logToFile !== false) {
    const path = state?.settings?.logFilePath || DEFAULT_LOG_FILE_PATH;
    browser.existingDraft.appendLog(path, line).catch(error =>
      console.error("[reopen-drafts] log-file-write-failed", { path, message: error.message })
    );
  }
}

function logError(event, error, data = {}) {
  log(event, { ...data, message: error?.message ?? String(error) });
  console.error(`[reopen-drafts] ${event}`, error);
}

function defaultState() {
  return {
    version: 5,
    mode: "NORMAL",
    settings: { ...DEFAULT_SETTINGS },
    entries: [],
    deletedDraftIdentityKeys: [],
    deletedDraftTabIds: {},
    browserConsole: { open: false, geometry: null },
  };
}

function toIdentity(message) {
  const { folder, headerMessageId } = message;
  if (!folder?.id || !folder?.accountId || !headerMessageId) {
    throw new Error("Saved draft is missing folder/account/RFC Message-ID metadata");
  }
  return {
    accountId: folder.accountId,
    folderId: folder.id,
    headerMessageId,
  };
}

function geometryFromWindow(window) {
  if (!window) return null;
  return {
    left: Number.isInteger(window.left) ? window.left : null,
    top: Number.isInteger(window.top) ? window.top : null,
    width: Number.isInteger(window.width) ? window.width : null,
    height: Number.isInteger(window.height) ? window.height : null,
    state: window.state === "maximized" ? "maximized" : "normal",
  };
}

function sameGeometry(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function loadState() {
  if (state) return state;
  const stored = await browser.storage.local.get([STATE_KEY, LEGACY_RECORD_KEY]);
  state = { ...defaultState(), ...(stored[STATE_KEY] ?? {}) };
  state.settings = { ...DEFAULT_SETTINGS, ...(state.settings ?? {}) };
  // Use Thunderbird's platform-specific temporary directory for a new
  // installation. An explicitly saved path is never replaced.
  if (!stored[STATE_KEY]?.settings?.logFilePath) {
    state.settings.logFilePath = await browser.existingDraft.getDefaultLogFilePath()
      .catch(() => DEFAULT_LOG_FILE_PATH);
  }
  // Version 2 introduced Ask as its implicit default. Upgrade it to the new
  // Always default so an existing test installation does not stay silently idle.
  if ((state.version ?? 0) < 3 && state.settings.draftRestore === "ask") {
    state.settings.draftRestore = "always";
  }
  state.version = 5;
  state.entries = Array.isArray(state.entries) ? state.entries : [];
  // Version 5 records deletion tombstones by account + RFC Message-ID. The
  // older exact entry key also contained folderId, which can differ by the
  // time Thunderbird reports a delete/move operation.
  const legacyDeletedKeys = Array.isArray(state.deletedDraftKeys) ? state.deletedDraftKeys : [];
  state.deletedDraftIdentityKeys = [
    ...(Array.isArray(state.deletedDraftIdentityKeys) ? state.deletedDraftIdentityKeys : []),
    ...legacyDeletedKeys.map(key => {
      const parts = typeof key === "string" ? key.split("\u0000") : [];
      return parts.length === 3
        ? durableDraftIdentityKey({ accountId: parts[0], headerMessageId: parts[2] })
        : null;
    }),
  ].filter(key => typeof key === "string");
  delete state.deletedDraftKeys;
  state.deletedDraftTabIds = Object.fromEntries(Object.entries(state.deletedDraftTabIds ?? {})
    .filter(([key, tabId]) => typeof key === "string" && Number.isInteger(tabId)));
  // Tombstones only protect an still-open compose tab from being re-scanned.
  // A legacy key without its tab association cannot provide that protection and
  // must not grow session storage indefinitely.
  state.deletedDraftIdentityKeys = [...new Set(state.deletedDraftIdentityKeys)].filter(key =>
    Number.isInteger(state.deletedDraftTabIds[key])
  );
  state.browserConsole = {
    open: Boolean(state.browserConsole?.open),
    geometry: state.browserConsole?.geometry ?? null,
  };

  log("state-loaded", {
    entries: state.entries.length,
    hasLegacyStage1Draft: Boolean(stored[LEGACY_RECORD_KEY]),
    settings: state.settings,
  });

  // Preserve the demonstrated Stage 1 draft if an upgrade happens before another save.
  if (!state.entries.length && stored[LEGACY_RECORD_KEY]) {
    state.entries.push({
      ...stored[LEGACY_RECORD_KEY],
      key: entryKey(stored[LEGACY_RECORD_KEY]),
      composeType: "draft",
      identityId: null,
      tabId: null,
      windowId: null,
      geometry: null,
      subject: "(subject unavailable)",
    });
  }
  await persist();
  return state;
}

async function persist() {
  if (!state) return;
  await browser.storage.local.set({ [STATE_KEY]: state });
}

function enqueueMutation(event, operation) {
  const run = mutationTail.then(operation, operation);
  mutationTail = run.catch(error => logError("state-mutation-failed", error, { event }));
  return run;
}

async function captureGeometry(tab) {
  if (!tab?.windowId) return null;
  try {
    return geometryFromWindow(await browser.windows.get(tab.windowId));
  } catch (_error) {
    return null;
  }
}

async function captureSavedDraft(tab, saveInfo) {
  log("compose-after-save-event", {
    tabId: tab?.id ?? null,
    mode: saveInfo?.mode ?? null,
    error: Boolean(saveInfo?.error),
    messageCount: saveInfo?.messages?.length ?? 0,
  });
  if (saveInfo.error || !["autoSave", "draft"].includes(saveInfo.mode)) return;
  const [message] = saveInfo.messages ?? [];
  if (!message) {
    log("save-not-captured", { mode: saveInfo.mode, reason: "no MessageHeader" });
    return;
  }

  try {
    await loadState();
    const identity = toIdentity(message);
    const key = entryKey(identity);
    const deletedIdentityKey = durableDraftIdentityKey(identity);
    if (isDeletedDraftKey(state.deletedDraftIdentityKeys, deletedIdentityKey)) {
      log("save-skipped-deleted-draft", { mode: saveInfo.mode, key });
      return;
    }
    const details = await browser.compose.getComposeDetails(tab.id).catch(() => ({}));
    const geometry = await captureGeometry(tab);
    const entry = {
      ...identity,
      key,
      composeType: details.type ?? "draft",
      identityId: details.identityId ?? null,
      tabId: tab.id,
      windowId: tab.windowId ?? null,
      geometry,
      // Display-only snapshot. It is never used to identify or resolve a
      // draft, and avoids a folder query merely to populate settings/Ask UI.
      subject: message.subject || "(no subject)",
    };
    // A draft save can replace Message-ID, so replace this window's previous entry.
    state.entries = upsertDraftEntry(state.entries, entry);
    await persist();
    log("captured", { mode: saveInfo.mode, ...identity });
  } catch (error) {
    logError("capture-failed", error);
  }
}

async function scanOpenComposeDrafts() {
  await loadState();
  const openDrafts = await browser.existingDraft.listOpenComposeDrafts();
  let changed = false;
  for (const openDraft of openDrafts) {
    try {
      const identity = toIdentity(openDraft.message);
      const key = entryKey(identity);
      const deletedIdentityKey = durableDraftIdentityKey(identity);
      if (isDeletedDraftKey(state.deletedDraftIdentityKeys, deletedIdentityKey)) {
        log("compose-scan-skipped-deleted-draft", { key, tabId: openDraft.tabId });
        continue;
      }
      const details = await browser.compose.getComposeDetails(openDraft.tabId).catch(() => ({}));
      const tab = { id: openDraft.tabId, windowId: openDraft.windowId };
      const entry = {
        ...identity,
        key,
        composeType: details.type ?? "draft",
        identityId: details.identityId ?? null,
        tabId: openDraft.tabId,
        windowId: openDraft.windowId,
        geometry: await captureGeometry(tab),
        subject: openDraft.message.subject || "(no subject)",
      };
      const nextEntries = upsertDraftEntry(state.entries, entry);
      changed ||= JSON.stringify(nextEntries) !== JSON.stringify(state.entries);
      state.entries = nextEntries;
      log("compose-scan-captured", { key: entry.key, tabId: entry.tabId, windowId: entry.windowId });
    } catch (error) {
      logError("compose-scan-entry-failed", error);
    }
  }
  if (changed) await persist();
  log("compose-scan-complete", { openDrafts: openDrafts.length, trackedEntries: state.entries.length });
}

async function removeEntries(predicate, event) {
  await loadState();
  const removed = state.entries.filter(predicate);
  if (!removed.length) return 0;
  state.entries = removeDraftEntries(state.entries, predicate);
  await persist();
  log(event, { count: removed.length });
  return removed.length;
}

async function shouldPreserveClosingWindow(reason) {
  await loadState();
  const applicationQuitting = await browser.existingDraft.isApplicationQuitting();
  const preserve = shouldPreserveComposeClose({
    mode: state.mode,
    preserveOnMainClose: state.settings.preserveOnMainClose,
    applicationQuitting,
  });
  if (preserve && state.mode !== "PRESERVE_ON_EXIT" && applicationQuitting) {
    state.mode = "PRESERVE_ON_EXIT";
    await persist();
    log("session-preserved-for-application-quit", { reason, entries: state.entries.length });
  }
  return preserve;
}

async function updateComposeGeometry() {
  await loadState();
  let changed = false;
  for (const entry of state.entries) {
    if (!Number.isInteger(entry.tabId) || !Number.isInteger(entry.windowId)) continue;
    try {
      // Window IDs are recycled after Thunderbird restarts. In particular, an
      // Ask dialog can inherit the ID that belonged to a prior compose window.
      // Only sample geometry after proving this is still that live compose tab.
      const tab = await browser.tabs.get(entry.tabId);
      if (tab.type !== "messageCompose" || tab.windowId !== entry.windowId) continue;
      const geometry = geometryFromWindow(await browser.windows.get(tab.windowId));
      if (!sameGeometry(geometry, entry.geometry)) {
        entry.geometry = geometry;
        changed = true;
      }
    } catch (_error) {
      // Closed windows are handled by tabs/windows removal events.
    }
  }
  if (changed) await persist();
}

async function clearStaleComposeAssociations() {
  await loadState();
  let cleared = 0;
  for (const entry of state.entries) {
    if (!Number.isInteger(entry.tabId) && !Number.isInteger(entry.windowId)) continue;
    let tab = null;
    try { tab = await browser.tabs.get(entry.tabId); } catch (_error) {}
    if (tab?.type === "messageCompose" && tab.windowId === entry.windowId) continue;
    entry.tabId = null;
    entry.windowId = null;
    cleared += 1;
  }
  if (cleared) {
    await persist();
    log("stale-compose-associations-cleared", { count: cleared });
  }
}

async function mainWindowIds() {
  return browser.existingDraft.getMainWindowIds();
}

async function refreshSessionMode() {
  await loadState();
  const ids = await mainWindowIds().catch(() => []);
  const previous = state.mode;
  state.mode = nextSessionMode({
    mode: state.mode,
    mainWindowCount: ids.length,
    preserveOnMainClose: state.settings.preserveOnMainClose,
    trackedEntryCount: state.entries.length,
    browserConsoleOpen: state.browserConsole.open,
  });
  if (previous !== state.mode) {
    await persist();
    log("session-mode", { from: previous, to: state.mode });
  }
  return ids;
}

async function applyToolbarVisibility() {
  await loadState();
  await browser.existingDraft.setToolbarVisible(state.settings.toolbarVisible);
}

async function applyToolbarIcon() {
  await loadState();
  await browser.action.setIcon({ path: TOOLBAR_ICON_PATHS[state.settings.toolbarIcon] ?? TOOLBAR_ICON_PATHS.beer });
}

async function updateBrowserConsoleState() {
  await loadState();
  const observed = await browser.existingDraft.getBrowserConsole();
  if (observed.open) {
    const geometry = geometryFromWindow(observed);
    if (!state.browserConsole.open || !sameGeometry(state.browserConsole.geometry, geometry)) {
      state.browserConsole = { open: true, geometry };
      await persist();
      log("browser-console-observed", { geometry });
    }
  } else if (observingCurrentSession && state.browserConsole.open && state.mode === "NORMAL") {
    state.browserConsole = { open: false, geometry: null };
    await persist();
    log("browser-console-closed-normal");
  }
}

async function applyComposeGeometry(tab, geometry) {
  if (!geometry || !tab?.windowId) return;
  const update = { focused: true, ...composeGeometryRestoreUpdate(geometry, state.settings) };
  try {
    log("compose-geometry-apply-request", { windowId: tab.windowId, update, savedGeometry: geometry });
    const actual = await browser.windows.update(tab.windowId, update);
    log("compose-geometry-applied", { windowId: tab.windowId, actual: geometryFromWindow(actual) });
  } catch (error) {
    log("compose-geometry-not-applied", { windowId: tab.windowId, message: error.message });
  }
}

function waitForComposeTab(timeout = 10000) {
  let listener;
  let timer;
  let resolvePromise;
  const promise = new Promise(resolve => {
    resolvePromise = resolve;
    timer = setTimeout(() => {
      browser.tabs.onCreated.removeListener(listener);
      resolve(null);
    }, timeout);
    listener = tab => {
      if (tab.type !== "messageCompose") return;
      clearTimeout(timer);
      browser.tabs.onCreated.removeListener(listener);
      resolve(tab);
    };
    browser.tabs.onCreated.addListener(listener);
  });
  return {
    promise,
    cancel() {
      clearTimeout(timer);
      browser.tabs.onCreated.removeListener(listener);
      resolvePromise(null);
    },
  };
}

async function openEntry(entry) {
  log("restore-draft-attempt", { key: entry.key, folderId: entry.folderId });
  const pendingTab = waitForComposeTab();
  const result = await browser.existingDraft.openDurableDraft(entry.folderId, entry.headerMessageId);
  const disposition = restoreDisposition(result);
  if (disposition === "prune") {
    pendingTab.cancel();
    await removeEntries(candidate => candidate.key === entry.key, "stale-entry-removed");
    log("restore-draft-skipped-missing", { key: entry.key });
    return false;
  }
  if (disposition !== "restored") {
    pendingTab.cancel();
    log("restore-draft-skipped-unavailable", { key: entry.key, reason: result.reason });
    return false;
  }
  const tab = result.status === "opened" ? await pendingTab.promise : null;
  if (result.status !== "opened") pendingTab.cancel();
  if (tab) {
    entry.tabId = tab.id;
    entry.windowId = tab.windowId;
    await applyComposeGeometry(tab, entry.geometry);
    await persist();
  }
  log("native-open-request", { status: result.status });
  return true;
}

async function accountOrder() {
  const accounts = await browser.accounts.list();
  return new Map(accounts.map((account, index) => [account.id, { index, name: account.name }]));
}

async function popupModel() {
  await loadState();
  const order = await accountOrder();
  const records = [];
  for (const entry of [...state.entries]) {
    const account = order.get(entry.accountId) ?? { index: Number.MAX_SAFE_INTEGER, name: entry.accountId };
    records.push({
      key: entry.key,
      accountId: entry.accountId,
      accountName: account.name,
      accountIndex: account.index,
      subject: entry.subject || "(subject unavailable)",
    });
  }
  records.sort((a, b) => a.accountIndex - b.accountIndex || a.subject.localeCompare(b.subject));
  const groups = [];
  for (const record of records) {
    let group = groups.at(-1);
    if (!group || group.accountId !== record.accountId) {
      group = { accountId: record.accountId, accountName: record.accountName, drafts: [] };
      groups.push(group);
    }
    group.drafts.push({ key: record.key, subject: record.subject });
  }
  return { settings: state.settings, groups, count: records.length };
}

async function restoreEntries(keys = null) {
  await loadState();
  // Belt and suspenders: an onDeleted event removes the entry immediately.
  // If Thunderbird exits while its compose window remains open, a persisted
  // tombstone also prevents any stale record from being opened at startup.
  const withoutDeleted = removeDeletedDraftEntries(state.entries, state.deletedDraftIdentityKeys);
  if (withoutDeleted.length !== state.entries.length) {
    const removed = state.entries.length - withoutDeleted.length;
    state.entries = withoutDeleted;
    await persist();
    log("startup-deleted-entry-pruned", { count: removed });
  }
  const entries = state.entries.filter(entry => !keys || keys.includes(entry.key));
  for (const entry of entries) await openEntry(entry);
  await clearActionBadge();
}

async function restoreBrowserConsoleIfNeeded() {
  await loadState();
  const setting = state.settings.browserConsoleRestore;
  if (setting === "never" || (setting === "if-open" && !state.browserConsole.open)) {
    log("browser-console-restore-skipped", { setting, previouslyOpen: state.browserConsole.open });
    return;
  }
  try {
    const geometry = state.browserConsole.geometry && {
      ...(state.settings.restorePosition ? {
        left: state.browserConsole.geometry.left,
        top: state.browserConsole.geometry.top,
      } : {}),
      ...(state.settings.restoreSize ? {
        width: state.browserConsole.geometry.width,
        height: state.browserConsole.geometry.height,
        state: state.browserConsole.geometry.state,
      } : {}),
    };
    log("browser-console-restore-attempt", { setting, geometry });
    await browser.existingDraft.openBrowserConsole(geometry);
    log("browser-console-restore-requested", { setting });
  } catch (error) {
    logError("browser-console-restore-failed", error, { setting });
  }
}

async function clearActionBadge() {
  // The toolbar is settings-only. A draft count above its title is both
  // misleading and unnecessary because the full settings page shows details.
  await browser.action.setBadgeText({ text: "" });
}

async function restoreAtStartup() {
  if (startupRestoreStarted) return;
  startupRestoreStarted = true;
  await loadState();
  const mainIds = await refreshSessionMode();
  await clearStaleComposeAssociations();
  await scanOpenComposeDrafts();
  await applyToolbarVisibility();
  log("startup-restore-begin", {
    entries: state.entries.length,
    mode: state.mode,
    settings: state.settings,
    mainWindowIds: mainIds,
    consolePreviouslyOpen: state.browserConsole.open,
  });
  await updateBrowserConsoleState();
  await restoreBrowserConsoleIfNeeded();
  if (state.settings.draftRestore === "always") {
    log("startup-draft-restore-always", { entries: state.entries.length });
    await restoreEntries();
  } else if (state.settings.draftRestore === "ask" && state.entries.length && mainIds.length) {
    let opened = false;
    try {
      await browser.windows.create({
        url: browser.runtime.getURL("ask.html"),
        type: "popup",
        width: 520,
        height: 480,
      });
      opened = true;
    } catch (error) {
      logError("ask-dialog-open-failed", error);
    }
    log("startup-draft-restore-ask", { entries: state.entries.length, dialogOpened: opened });
  } else {
    log("startup-draft-restore-skipped", { setting: state.settings.draftRestore, entries: state.entries.length, mainWindows: mainIds.length });
  }
  await clearActionBadge();
  observingCurrentSession = true;
}

async function setSettings(next, source = "settings") {
  await loadState();
  const previous = { ...state.settings };
  const allowedConsole = new Set(["always", "never", "if-open"]);
  const allowedDrafts = new Set(["always", "never", "ask"]);
  const allowedToolbarIcons = new Set(["beer", "window"]);
  if (next.browserConsoleRestore && !allowedConsole.has(next.browserConsoleRestore)) throw new Error("Invalid Browser Console setting");
  if (next.draftRestore && !allowedDrafts.has(next.draftRestore)) throw new Error("Invalid draft setting");
  if (next.toolbarIcon && !allowedToolbarIcons.has(next.toolbarIcon)) throw new Error("Invalid toolbar icon setting");
  if (next.logFilePath !== undefined && (typeof next.logFilePath !== "string" || !next.logFilePath.trim())) {
    throw new Error("Log file path must not be empty");
  }
  for (const key of ["toolbarVisible", "restorePosition", "restoreSize", "logToFile"]) {
    if (next[key] !== undefined && typeof next[key] !== "boolean") throw new Error(`Invalid ${key} setting`);
  }
  state.settings = {
    ...state.settings,
    ...Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined)),
  };
  await persist();
  await applyToolbarVisibility();
  await applyToolbarIcon();
  if (source === "toolbar" && state.settings.toolbarVisible === false && next.toolbarVisible === false && previous.toolbarVisible) {
    try {
      await browser.windows.create({
        url: browser.runtime.getURL("toolbar-hidden.html"), type: "popup", width: 440, height: 220,
      });
    } catch (error) {
      logError("toolbar-hidden-dialog-open-failed", error);
    }
  }
  log("settings-updated", { settings: state.settings });
  return state.settings;
}

browser.compose.onAfterSave.addListener((tab, saveInfo) =>
  enqueueMutation("compose-after-save", () => captureSavedDraft(tab, saveInfo))
);
browser.tabs.onCreated.addListener(tab => {
  if (tab.type !== "messageCompose") return;
  log("compose-window-created", { tabId: tab.id, windowId: tab.windowId });
});
browser.compose.onComposeStateChanged.addListener((tab, composeState) => {
  log("compose-state-changed", { tabId: tab.id, windowId: tab.windowId ?? null, stateKeys: Object.keys(composeState ?? {}) });
  // Thunderbird emits this after compose state changes. Unlike the former
  // timed retry, this reacts to Thunderbird's lifecycle signal immediately.
  // An unsaved new message has no draftId and is captured by onAfterSave.
  enqueueMutation("compose-state-scan", () => scanOpenComposeDrafts())
    .catch(error => logError("compose-state-scan-failed", error, { tabId: tab.id }));
});
browser.compose.onAfterSend.addListener((tab, sendInfo) => {
  enqueueMutation("compose-sent", async () => {
    const action = lifecycleDisposition({ event: "send", sendError: Boolean(sendInfo.error) });
    log("compose-send-event", { tabId: tab.id, error: Boolean(sendInfo.error), action });
    if (action === "remove") {
      const removed = await removeEntries(entry => entry.tabId === tab.id, "sent-entry-removed");
      if (!removed) log("sent-entry-already-removed", { tabId: tab.id });
    }
  }).catch(error => logError("compose-send-handling-failed", error, { tabId: tab.id }));
});
browser.messages.onDeleted.addListener(messageList => {
  const deletedIdentityKeys = new Set((messageList.messages ?? []).map(message => {
    try { return durableDraftIdentityKey(toIdentity(message)); } catch (_error) { return null; }
  }).filter(Boolean));
  if (deletedIdentityKeys.size) {
    enqueueMutation("message-deleted", async () => {
      await loadState();
      // Folder identity can have changed while Thunderbird processes a delete;
      // account + RFC Message-ID remains the durable correlation.
      const removed = state.entries.filter(entry =>
        deletedIdentityKeys.has(durableDraftIdentityKey(entry))
      );
      const trackedIdentityKeys = removed.map(durableDraftIdentityKey);
      state.deletedDraftIdentityKeys = withDeletedDraftKeys(
        state.deletedDraftIdentityKeys,
        [...deletedIdentityKeys, ...trackedIdentityKeys]
      );
      for (const entry of removed) {
        if (Number.isInteger(entry.tabId)) {
          state.deletedDraftTabIds[durableDraftIdentityKey(entry)] = entry.tabId;
        }
      }
      log("message-delete-event", {
        entries: deletedIdentityKeys.size,
        identities: [...deletedIdentityKeys],
        action: lifecycleDisposition({ event: "delete" }),
      });
      state.entries = removeDraftEntries(state.entries, entry =>
        deletedIdentityKeys.has(durableDraftIdentityKey(entry))
      );
      await persist();
      if (removed.length) log("deleted-entry-removed", { count: removed.length });
      else log("deleted-entry-not-tracked", { identities: [...deletedIdentityKeys] });
    }).catch(error => logError("message-delete-handling-failed", error));
  }
});
browser.tabs.onRemoved.addListener((tabId, removeInfo) => {
  enqueueMutation("compose-tab-removed", async () => {
    await loadState();
    const clearedTombstones = state.deletedDraftIdentityKeys.filter(key =>
      state.deletedDraftTabIds[key] === tabId
    );
    if (clearedTombstones.length) {
      state.deletedDraftIdentityKeys = state.deletedDraftIdentityKeys.filter(key => !clearedTombstones.includes(key));
      for (const key of clearedTombstones) delete state.deletedDraftTabIds[key];
      await persist();
      log("deleted-draft-tombstones-cleared", { tabId, count: clearedTombstones.length });
    }
    // tabs.onRemoved also fires for mail and extension tabs. Only a tracked
    // compose tab participates in this lifecycle decision.
    if (!state.entries.some(entry => entry.tabId === tabId)) return;
    const preserve = await shouldPreserveClosingWindow("compose-tab-removed");
    const action = lifecycleDisposition({
      event: "compose-close",
      mode: preserve ? "PRESERVE_ON_EXIT" : "NORMAL",
      preserveOnMainClose: state.settings.preserveOnMainClose,
      applicationQuitting: false,
    });
    log("compose-close-event", { tabId, isWindowClosing: removeInfo.isWindowClosing, preserve, action });
    if (action === "remove") await removeEntries(entry => entry.tabId === tabId, "compose-closed-normal");
    if (removeInfo.isWindowClosing) await updateComposeGeometry();
  }).catch(error => logError("compose-close-handling-failed", error, { tabId }));
});
browser.windows.onRemoved.addListener(windowId => {
  enqueueMutation("window-removed", async () => {
    // Compose lifecycle is handled by tabs.onRemoved. Do not infer it from a
    // bare window ID: those IDs are recycled and can belong to Ask popups.
    await refreshSessionMode();
    await updateBrowserConsoleState();
  }).catch(error => logError("window-close-handling-failed", error, { windowId }));
});
browser.windows.onCreated.addListener(() => enqueueMutation("window-created", () =>
  Promise.all([refreshSessionMode(), applyToolbarVisibility(), applyToolbarIcon()])
).catch(error => logError("main-window-refresh-failed", error)));
browser.runtime.onStartup.addListener(() => setTimeout(() =>
  enqueueMutation("startup", restoreAtStartup).catch(error => logError("startup-restore-failed", error)), 1200
));
browser.runtime.onMessage.addListener(message => enqueueMutation("runtime-message", async () => {
  await loadState();
  switch (message?.type) {
    case "get-popup":
      return popupModel();
    case "set-settings":
      return { settings: await setSettings(message.settings ?? {}, message.source) };
    case "restore-selected":
      await restoreEntries(message.keys ?? []);
      return popupModel();
    case "restore-all":
      await restoreEntries();
      return popupModel();
    case "forget-session":
      state.entries = [];
      state.browserConsole = { open: false, geometry: null };
      await persist();
      await clearActionBadge();
      return popupModel();
    default:
      return undefined;
  }
}));
browser.commands?.onCommand.addListener(command => {
  if (command === "restore-previous-compose-session") {
    enqueueMutation("manual-restore", restoreEntries).catch(error => logError("manual-restore-failed", error));
  }
  if (command === "forget-previous-compose-session") {
    enqueueMutation("forget-session", async () => {
      state.entries = [];
      state.browserConsole = { open: false, geometry: null };
      await persist();
      await clearActionBadge();
    }).catch(error => logError("forget-session-failed", error));
  }
});

setInterval(() => {
  enqueueMutation("state-poll", () =>
    // Geometry and Browser Console visibility have no WebExtension lifecycle
    // events. Draft membership and main-window mode are event-driven.
    Promise.all([updateComposeGeometry(), updateBrowserConsoleState()])
  ).catch(error => logError("state-poll-failed", error));
}, 1000);

enqueueMutation("background-initialization", async () => {
  await loadState();
  log("background-started", { logFilePath: state.settings.logFilePath });
  return Promise.all([scanOpenComposeDrafts(), refreshSessionMode(), updateBrowserConsoleState(), clearActionBadge(), applyToolbarVisibility(), applyToolbarIcon()]);
}).catch(error => logError("background-initialization-failed", error));
