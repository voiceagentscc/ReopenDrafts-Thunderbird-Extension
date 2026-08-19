export function entryKey({ accountId, folderId, headerMessageId }) {
  return `${accountId}\u0000${folderId}\u0000${headerMessageId}`;
}

// A folder is part of the lookup key, but not of a deletion identity. During
// delete/move processing Thunderbird can report the header with a different
// folder association from the one recorded when the draft was saved.
export function durableDraftIdentityKey({ accountId, headerMessageId }) {
  return `${accountId}\u0000${headerMessageId}`;
}

export function upsertDraftEntry(entries, entry) {
  // A save can replace the RFC Message-ID. The compose tab is the stable
  // in-session association, so replace its old identity atomically.
  const retained = entries.filter(candidate =>
    candidate.tabId !== entry.tabId && candidate.key !== entry.key
  );
  return [...retained, entry];
}

export function removeDraftEntries(entries, predicate) {
  return entries.filter(entry => !predicate(entry));
}

export function withDeletedDraftKeys(existingKeys, deletedKeys) {
  return [...new Set([...existingKeys, ...deletedKeys])];
}

export function isDeletedDraftKey(deletedKeys, key) {
  return deletedKeys.includes(key);
}

export function composeGeometryRestoreUpdate(geometry, { restorePosition, restoreSize }) {
  if (restoreSize && geometry?.state === "maximized") return { state: "maximized" };
  const update = {};
  for (const property of [
    ...(restorePosition ? ["left", "top"] : []),
    ...(restoreSize ? ["width", "height"] : []),
  ]) {
    if (Number.isInteger(geometry?.[property])) update[property] = geometry[property];
  }
  return update;
}

export function removeDeletedDraftEntries(entries, deletedIdentityKeys) {
  return removeDraftEntries(entries, entry =>
    isDeletedDraftKey(deletedIdentityKeys, durableDraftIdentityKey(entry))
  );
}

export function shouldPreserveComposeClose({ mode, preserveOnMainClose, applicationQuitting }) {
  return mode === "PRESERVE_ON_EXIT" || (preserveOnMainClose && applicationQuitting);
}

export function nextSessionMode({
  mode,
  mainWindowCount,
  preserveOnMainClose,
  trackedEntryCount,
  browserConsoleOpen,
}) {
  if (mainWindowCount > 0) return "NORMAL";
  if (preserveOnMainClose && (trackedEntryCount > 0 || browserConsoleOpen)) {
    return "PRESERVE_ON_EXIT";
  }
  return mode;
}

export function lifecycleDisposition({ event, mode, preserveOnMainClose, applicationQuitting, sendError = false }) {
  switch (event) {
    case "compose-close":
      return shouldPreserveComposeClose({ mode, preserveOnMainClose, applicationQuitting })
        ? "retain"
        : "remove";
    case "send":
      return sendError ? "retain" : "remove";
    case "delete":
      return "remove";
    // Thunderbird does not emit a close event when the user cancels its
    // close/save dialog, so cancellation must never alter session state.
    case "close-cancelled":
    default:
      return "retain";
  }
}

export function restoreDisposition(result) {
  if (result.status === "missing") return "prune";
  if (result.status === "unavailable") return "retain";
  if (result.status === "opened" || result.status === "focused") return "restored";
  return "retain";
}
