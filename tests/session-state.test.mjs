import assert from "node:assert/strict";
import test from "node:test";
import {
  composeGeometryRestoreUpdate,
  durableDraftIdentityKey,
  entryKey,
  isDeletedDraftKey,
  lifecycleDisposition,
  nextSessionMode,
  removeDeletedDraftEntries,
  removeDraftEntries,
  shouldPreserveComposeClose,
  upsertDraftEntry,
  withDeletedDraftKeys,
} from "../session-state.js";

const identity = headerMessageId => ({
  accountId: "account-a",
  folderId: "account-a://Drafts",
  headerMessageId,
});

const entry = (id, tabId = 10) => ({ ...identity(id), key: entryKey(identity(id)), tabId, windowId: tabId + 100 });

test("opening or saving the same compose draft is idempotent", () => {
  const first = entry("one@example.invalid");
  const result = upsertDraftEntry([first], { ...first, windowId: 111 });
  assert.deepEqual(result, [{ ...first, windowId: 111 }]);
});

test("saving with a replacement RFC Message-ID atomically replaces the old entry", () => {
  const oldEntry = entry("old@example.invalid");
  const replacement = entry("new@example.invalid");
  const result = upsertDraftEntry([oldEntry], replacement);
  assert.deepEqual(result, [replacement]);
});

test("display subject is retained as metadata but never participates in durable identity", () => {
  const first = { ...entry("same@example.invalid"), subject: "first" };
  const updated = { ...first, subject: "updated" };
  const result = upsertDraftEntry([first], updated);
  assert.equal(result.length, 1);
  assert.equal(result[0].key, first.key);
  assert.equal(result[0].subject, "updated");
});

test("a delayed deletion for an old Message-ID cannot remove the replacement", () => {
  const replacement = entry("new@example.invalid");
  const oldKey = entry("old@example.invalid").key;
  const result = removeDraftEntries([replacement], candidate => candidate.key === oldKey);
  assert.deepEqual(result, [replacement]);
});

test("an explicit delete removes only its matching draft", () => {
  const first = entry("one@example.invalid", 10);
  const second = entry("two@example.invalid", 11);
  const result = removeDraftEntries([first, second], candidate => candidate.key === first.key);
  assert.deepEqual(result, [second]);
});

test("a deleted draft identity remains tombstoned while its compose window is still open", () => {
  const deleted = entry("deleted@example.invalid");
  const keys = withDeletedDraftKeys([], [deleted.key]);
  assert.equal(isDeletedDraftKey(keys, deleted.key), true);
  assert.equal(isDeletedDraftKey(keys, entry("other@example.invalid").key), false);
  assert.deepEqual(withDeletedDraftKeys(keys, [deleted.key]), [deleted.key]);
});

test("a deletion removes the tracked draft even if Thunderbird reports another folder", () => {
  const draftsEntry = entry("deleted@example.invalid");
  const other = entry("other@example.invalid", 11);
  const deletionReportedFromTrash = durableDraftIdentityKey({
    accountId: "account-a",
    headerMessageId: "deleted@example.invalid",
  });
  assert.deepEqual(
    removeDeletedDraftEntries([draftsEntry, other], [deletionReportedFromTrash]),
    [other]
  );
});

test("a persisted deletion tombstone prevents startup restoration of that draft", () => {
  const deleted = entry("deleted@example.invalid");
  const retained = entry("retained@example.invalid", 11);
  const result = removeDeletedDraftEntries(
    [deleted, retained],
    [durableDraftIdentityKey(deleted)]
  );
  assert.deepEqual(result, [retained]);
});

test("a normal compose close removes its tracked entry", () => {
  const first = entry("one@example.invalid", 10);
  const second = entry("two@example.invalid", 11);
  const result = removeDraftEntries([first, second], candidate => candidate.tabId === 10);
  assert.deepEqual(result, [second]);
});

test("restore geometry preserves virtual-desktop coordinates for multi-monitor drafts", () => {
  const geometry = { left: 2099, top: 761, width: 1277, height: 1174, state: "normal" };
  assert.deepEqual(
    composeGeometryRestoreUpdate(geometry, { restorePosition: true, restoreSize: true }),
    { left: 2099, top: 761, width: 1277, height: 1174 }
  );
  assert.deepEqual(
    composeGeometryRestoreUpdate(geometry, { restorePosition: false, restoreSize: true }),
    { width: 1277, height: 1174 }
  );
});

test("restore geometry preserves maximized state only when size restoration is enabled", () => {
  const geometry = { left: 50, top: 50, width: 1200, height: 900, state: "maximized" };
  assert.deepEqual(
    composeGeometryRestoreUpdate(geometry, { restorePosition: true, restoreSize: true }),
    { state: "maximized" }
  );
  assert.deepEqual(
    composeGeometryRestoreUpdate(geometry, { restorePosition: true, restoreSize: false }),
    { left: 50, top: 50 }
  );
});

test("preserve mode retains compose entries across closing windows", () => {
  assert.equal(shouldPreserveComposeClose({ mode: "PRESERVE_ON_EXIT", preserveOnMainClose: true, applicationQuitting: false }), true);
  assert.equal(shouldPreserveComposeClose({ mode: "NORMAL", preserveOnMainClose: true, applicationQuitting: true }), true);
  assert.equal(shouldPreserveComposeClose({ mode: "NORMAL", preserveOnMainClose: true, applicationQuitting: false }), false);
});

test("closing the last main window preserves entries, while reopening main returns to normal close semantics", () => {
  const preserving = nextSessionMode({
    mode: "NORMAL",
    mainWindowCount: 0,
    preserveOnMainClose: true,
    trackedEntryCount: 3,
    browserConsoleOpen: false,
  });
  assert.equal(preserving, "PRESERVE_ON_EXIT");
  assert.equal(shouldPreserveComposeClose({
    mode: preserving, preserveOnMainClose: true, applicationQuitting: false,
  }), true);

  const normal = nextSessionMode({
    mode: preserving,
    mainWindowCount: 1,
    preserveOnMainClose: true,
    trackedEntryCount: 3,
    browserConsoleOpen: false,
  });
  assert.equal(normal, "NORMAL");
  assert.equal(shouldPreserveComposeClose({
    mode: normal, preserveOnMainClose: true, applicationQuitting: false,
  }), false);
});

test("lifecycle actions remove only successful sends, explicit deletes, and normal closes", () => {
  assert.equal(lifecycleDisposition({ event: "send", sendError: false }), "remove");
  assert.equal(lifecycleDisposition({ event: "send", sendError: true }), "retain");
  assert.equal(lifecycleDisposition({ event: "delete" }), "remove");
  assert.equal(lifecycleDisposition({
    event: "compose-close", mode: "NORMAL", preserveOnMainClose: true, applicationQuitting: false,
  }), "remove");
  assert.equal(lifecycleDisposition({
    event: "compose-close", mode: "PRESERVE_ON_EXIT", preserveOnMainClose: true, applicationQuitting: false,
  }), "retain");
  assert.equal(lifecycleDisposition({ event: "close-cancelled" }), "retain");
});
