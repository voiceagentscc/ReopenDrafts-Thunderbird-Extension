# Known issues and lifecycle limitations

## Deleted draft whose compose window remains open

Thunderbird's WebExtension `messages.onDeleted` event is used to remove a
draft from the restore session as soon as Thunderbird reports its deletion.
In testing, one delete-while-compose-window-open path did not deliver that
event to the extension. The compose window then remained capable of referring
to a now-stale local message header.

The extension is deliberately conservative in this case. It never recreates
or copies message content. At startup the native resolver must find the saved
draft header in its recorded folder before asking Thunderbird to edit it. If
that header is unavailable, restoration is silently skipped and a diagnostic
line is written to the configured log file and Browser Console. This prevents
the observed empty compose window and avoids user-visible errors.

When Thunderbird does report deletion, the extension immediately removes the
matching session entry and records a temporary account + RFC `Message-ID`
tombstone. That tombstone prevents an open compose window from adding the
deleted draft back to the session during later scans.

Consequently, the user-facing behavior is safe in both observed cases:

- A draft that is still saved reopens as that same Thunderbird draft.
- A deleted draft is not recreated, copied, or reopened as an empty message.

An unavailable record can remain in extension storage until a later lifecycle
event removes it or the user forgets the session. It is inert: it is not shown
as an error and cannot create a replacement draft.

## Diagnostic-log privacy

File logging is enabled by default to make early troubleshooting practical.
The local log records state transitions, settings, window geometry, and the
Thunderbird account/folder identifiers and RFC `Message-ID` values needed to
correlate a lifecycle operation. It does not record message bodies, recipients,
or attachments, and Reopen Drafts never uploads it. Review a log before
voluntarily sharing it because those identifiers can still be personal data.
