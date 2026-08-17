# ADR-0014: Deleting the last variant promotes its file

Date: 2026-08-17 · Status: accepted

## Context

[ADR-0013](0013-an-agent-file-may-declare-named-variants.md) makes a file that
declares variants yield its variants and nothing else. Its own name addresses
nothing — no chain can reach it.

Deleting a variant is therefore an edit to the declaring file, not a file delete
(#63). Deleting the *last* one leaves a file no chain can reach and no name the
namespace holds. Three answers were live:

- **Refuse it.** The user deletes the file instead.
- **Delete the file.** One action, but the prompt body disappears on an action
  the user framed as removing one variant.
- **Promote it.** The `variants:` block is dropped and the file becomes
  addressable by its own name again.

## Decision

**Promote.** The file got its variants by a `variants:` block being added to an
ordinary agent file; deleting the last one removes that block, and the ordinary
agent file is what is left. The same path, run backwards — no error to explain,
and nothing the user did not ask to delete.

Promotion mints the file's own name into the flat namespace ADR-0012 gives the
type, which it was never in. So it is refused when another file already declares
a variant by that name, naming that file — a duplicate is a hard load failure.

A separate decision in the same ticket: **a delete is refused while any typed
field still names what is going**, for a file exactly as for a variant. An
unresolvable reference stops the whole workspace loading (ADR-0012), so no delete
may create one. Deleting a *declaring* file is blocked by references to its
variants, never to its own name, which addresses nothing.

## Consequences

A promoted file's frontmatter `name:` stops being inert and becomes its display
name. Nothing else about the file changes.

Prose `{slug}` placeholders do not block a delete, the same way they do not
follow a rename (#54): they are textual and ambiguous, so they are the user's to
fix either way.

A delete now reads every holder file to answer "who names this?", the same walk a
rename already pays for. `lib/fs/entityRefs.ts` holds that walk for both.
