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
close, and explicit Forget Session. The extension records the compose window's
normal/maximized state, position, and size. During application quit or after
the last main mail window closes, it preserves tracked compose windows so the
ordinary shutdown sequence does not discard the session.

Only window geometry and Browser Console visibility use periodic observation;
they have no corresponding current WebExtension lifecycle event. Draft
membership and shutdown mode do not depend on polling.

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

The Browser Console can be restored **Always**, **Never**, or **If it was
open**. Reopen Drafts is the only Developer Tools window it manages.

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
- Browser Console restoration/geometry, extension disable/re-enable, and the
  optional toolbar recovery dialog.

The automated suite tests lifecycle reducers, durable native-draft resolution,
startup result handling, manifest packaging, settings controls, and virtual
desktop geometry requests. It cannot emulate a real multi-monitor compositor;
that behavior is covered by the manual tests above.

## Development and installation

```bash
npm run check
npm run package
npm run audit:public
```

This produces `dist/reopen-drafts.xpi`. Install it temporarily through
Thunderbird's Add-ons Manager. The current manifest targets Thunderbird 153.0.
The small privileged Experiment is required because standard WebExtension APIs
cannot open an existing message in Thunderbird's native editable Draft mode or
control the privileged Browser Console.

For development, use the Browser Console or the diagnostic log. Every
extension diagnostic is prefixed with `[reopen-drafts]` and is appended to
Thunderbird's platform temporary directory as `reopen-drafts.log` by default.
Change the absolute log-file path or disable file logging in the full settings
page. The privileged Experiment performs the append because ordinary
WebExtensions cannot write arbitrary local files.

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
