# Conditional workspace saves (#158)

`GET /api/workspace` advertises `capabilities.conditionalWorkspaceSaves: true`.
This capability covers entity `PUT /api/workspace/:type/:slug`. The linked
Obsidian consumer work is [obsidian-chain-runner#107](https://github.com/jasonhui1/obsidian-chain-runner/issues/107).

## Protocol and compatibility

The existing `{ data, content }` request remains an unconditional save. New
clients opt in by adding `expectedRaw`:

- A string means save only if the addressed storage file currently contains
  exactly that UTF-8 text. Use `raw` from the GET inspected by the user or from
  this client's last successful save receipt. Whitespace and line endings count.
- `null` means create only if the addressed file is absent. A prior 404 is not
  permission to overwrite a file created since that read.
- Other values are refused with 400. An omitted field retains legacy behavior.

Successful saves retain `success`, `filePath`, `slug`, and validation `warnings`,
and add `raw`: the exact serialized text passed to the successful filesystem
write. This is a receipt for that write, not a claim that the file still holds
that version when the caller receives the response. No follow-up GET is needed
to fingerprint the caller's own write. Never derive that ownership from a later
GET; another writer may have replaced it. A communication failure before a
receipt arrives leaves the caller uncertain whether the write succeeded.

A stale condition returns 409 with:

```json
{
  "error": "The file changed since it was inspected. Review the current file before saving again.",
  "code": "SAVE_CONFLICT",
  "slug": "writer",
  "currentRaw": "the current file text"
}
```

`currentRaw: null` means the file is absent. This is distinguishable from other
409 name-clash refusals. Preserve the local draft and let the user inspect this
text. If the user approves overwriting it, send that exact text as the next
condition; another change must cause another conflict. An older engine may ignore
unknown request fields: separately shipped consumers must feature-detect the
capability before relying on conditional saves or receipts.

## Addressing and validation

The save module owns resolution, comparison, serialization, write and receipt.
A variant addresses its declaring file; the condition covers the entire file,
including every variant. The returned slug remains the storage slug. A nested
file saves in place without creating a root twin (ADR-0012). Existing validation
warnings, forbidden-field refusals and agent-name reservations still apply.
No new identity normalization is introduced for legacy `.md` requests.

## Guarantee and limits

Run one engine process for a workspace. Resolution, comparison and the write
are synchronous and contain no yield, so cooperating requests in that process
cannot interleave inside a save. Two clients approving the same text cannot
both replace it with different text. Legacy unconditional writers can still
overwrite a successful save afterward; its receipt continues to identify only
its own write. Conditions compare content, not a monotonic generation counter:
a file changed and then restored to identical text satisfies the condition.

Direct filesystem changes completed before comparison are detected, including
edits made while a confirmation dialog is open. Create-only saves use exclusive
`wx` creation, so a direct writer creating the resolved target after comparison
still causes a conflict. This does not lock an external editor, a second engine
process, or namespace changes such as moving a file or adding another variant
declaration during the save. Existing-file saves have a compare-to-write window
against such writers and may overwrite a change made inside it. There is no
filesystem-wide compare-and-swap, crash-atomic replacement or durability promise.
The receipt identifies serialized UTF-8 text, not external bytes that may be
written afterward.

## Editor behavior and examples

The existing edit session sends its loaded or approved on-disk text as the
condition. A conflict pauses debounce and close-time writes. “Keep mine” approves
only the displayed conflict; “keep theirs” adopts it. Successful receipts update
the baseline using serialized text while preserving typing made during the
request. A deleted-file conflict reports an error and does not recreate the file.

Before: inspect A → approve A → another writer saves B → overwrite B silently.

After: inspect A → approve A → another writer saves B → 409 carrying B →
review B → approve B → condition the next save on B.

Core terms: **condition** = inspected or approved text; **receipt** = this save's
serialized write; **conflict** = the addressed file no longer matches the
condition; **cooperating clients** = requests handled by the same engine process.

Regression coverage uses the save module, production GET/PUT handlers, and the
existing editor store with controlled request ordering. Direct disk edits and
exclusive creation are exercised on temporary workspaces. Browser/owner visual
acceptance is separate from these automated checks.
