# Reopen Drafts

Reopen Drafts restores only the Thunderbird drafts that belonged to the prior
compose session. It reopens Thunderbird's existing saved draft in native
`Draft` compose mode, never creates a replacement message from copied content,
and never stores message bodies, recipients, attachments, or console history.
It stores a last-saved subject snapshot only for the settings and Ask dialogs;
the subject is never used to identify or reopen a draft.

The extension stores a durable draft locator consisting of Thunderbird account
and folder IDs plus the draft's RFC `Message-ID` header. The Experiment maps
the WebExtension folder ID through Thunderbird's own folder-ID resolver, reads
the native local folder database, and asks native compose code to edit that
same draft. It does not trigger an IMAP folder refresh merely to restore a
session. A deletion event removes an entry; an unavailable folder/header is
quietly retained and logged so it can be retried without ever creating a
replacement.

## Behavior

Every successful autosave or manual draft save updates session storage
immediately. Opening an already-saved draft is also captured from Thunderbird's
compose-state notification, without an arbitrary retry delay. Session membership
is changed only by those lifecycle events: saved/opened, send, delete, normal
close, and explicit Forget Session.

The extension is entirely event-driven and performs no periodic polling. The
compose window's normal/maximized state, position, and size are captured as a
snapshot when a draft is saved or an already-saved draft is opened; there is no
WebExtension lifecycle event for continuous window move/resize, so the stored
geometry is the value at the last save rather than a live-tracked position.
During application quit or after the last main mail window closes, it preserves
tracked compose windows so the ordinary shutdown sequence does not discard the
session.

## Close and discard behavior

In NORMAL mode, a compose-window close removes that window from the session,
whether Thunderbird saved its latest edits or the user chose not to save. A
cancelled close emits no close event and leaves the entry unchanged. In
PRESERVE_ON_EXIT mode, closing the window itself retains the entry; a successful
send or a `messages.onDeleted` event still removes it immediately.
If the deleted message's compose window remains open, the deleted account +
RFC `Message-ID` is remembered as a tombstone so later compose scans cannot
add that disappeared draft back into the session. The folder is deliberately
not part of that deletion correlation: Thunderbird may report a moved/deleted
header with a different folder association. On startup, tombstones prune any
matching stale record before the extension asks Thunderbird to open it.

Thunderbird's supported WebExtension lifecycle APIs do not report the user's
choice in the close/save dialog directly. Therefore the extension deliberately
does not guess that a window close was a discard. It treats Thunderbird's
message-deleted event as the authoritative deletion/discard signal.

Draft restoration at startup can be set to:

- **Always** — reopen every resolvable tracked draft.
- **Never** — retain the session without opening drafts automatically.
- **Ask** — open a separate startup selection dialog, grouped in Thunderbird
  account order, with individual draft checkboxes.

Settings include independent **Restore to previous position** and **Restore to
previous size** controls, both enabled by default. The Reopen Drafts toolbar
button is optional; when shown, it is a compact settings control only. It does
not show or restore the saved-draft list. Choose either the **Beer** (default)
or **Window** toolbar icon. The full settings page retains the current session
list for diagnostics and manual controls.

## Tested behavior

Manual testing on Thunderbird 153 under Arch Linux/Cinnamon has verified:

- IMAP Drafts across two accounts, including six drafts restored in one session;
- HTML and plain-text drafts, a simple attachment, and native identity/account
  preservation because the original saved draft is edited directly;
- Always and Ask startup restoration, per-draft selection, full-settings manual
  restore, normal close, send, delete, File → Quit preservation, and controlled
  `killall thunderbird` recovery;
- restored compose windows on a three-monitor Cinnamon layout, including a
  subsequent run with one monitor unavailable, where Thunderbird placed the
  affected draft on the primary monitor;
- extension disable/re-enable and the optional toolbar recovery dialog.

The automated suite tests lifecycle reducers, durable native-draft resolution,
startup result handling, manifest packaging, settings controls, and virtual
desktop geometry requests. It cannot emulate a real multi-monitor compositor;
that behavior is covered by the manual tests above.

## Versioning

`package.json` is the single source of truth for the version. `manifest.json`
is checked in so a freshly checked-out tree can be loaded directly as an unpacked
add-on, and a git `pre-commit` hook keeps its `version` field in lockstep with
`package.json` on every commit. Install the hook once per clone:

```bash
npm run setup
```

Continuous integration checks that the checked-in `manifest.json` matches
`package.json`. For a release, update `package.json`, run `npm run sync-version`,
commit both files, and tag that commit. The release workflow checks that the
tag matches `package.json` before packaging the XPI.

## Development and installation

```bash
npm run setup      # once per clone: install the version-sync git hook
npm run check
npm run package
npm run audit:public
```

`npm run package` produces `dist/reopen-drafts.xpi`. Install it through
Thunderbird's Add-ons Manager, or load the unpacked tree directly (the checked-in
`manifest.json` makes this work without a build step). The manifest supports
Thunderbird 153.0 and newer. Because the Experiment uses Thunderbird internals,
test draft restoration on each new major Thunderbird release.

The small privileged Experiment is required because standard WebExtension APIs
cannot open an existing message in Thunderbird's native editable Draft mode.

For development, use the diagnostic log. Every extension diagnostic is prefixed
with `[reopen-drafts]` and is appended to `reopen-drafts.log` in Thunderbird's
platform temporary directory by default — the path is resolved from that
directory at startup, so it is correct on every operating system. Disable file
logging in the full settings page if you prefer console-only diagnostics. The
privileged Experiment performs the append because ordinary WebExtensions cannot
write arbitrary local files. If a write fails (for example, an unwritable path),
the extension logs the failure once and continues with console-only logging
rather than failing silently.

The log is local only and is never uploaded by the extension. It includes
state transitions, settings, window geometry, and Thunderbird account/folder
identifiers plus RFC `Message-ID` values so lifecycle failures can be traced.
It does not contain message bodies, recipients, or attachments. Review the log
before voluntarily sharing it.

The diagnostic session list is read-only with respect to session state. Its
subjects are the snapshots captured on the last successful draft save or
already-saved-draft open; opening the list does not query folders, add entries,
remove entries, or validate entries.

Known lifecycle limitations and their non-destructive handling are documented
in [docs/issues.md](docs/issues.md).
