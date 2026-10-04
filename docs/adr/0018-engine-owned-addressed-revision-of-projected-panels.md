# ADR-0018: Engine-owned addressed revision of projected panels

Date: 2026-10-04 · Status: accepted

## Context

ADR-0015 gave chains the ability to project output sockets into layout panels, and
ADR-0017 streamed that projection to external clients (such as the Obsidian chain
runner). But when a user edited a panel in the client, replaying the change required
supplying a whole revised node output through `POST /api/runs/:id/fork` (`revisions:
{ [nodeId]: text }`).

Because `LayoutPanel` carried `node` but not `socket`, the consumer did not know which
section of a node's output a panel showed. When a single node produced multiple panels
(such as `## Pitch` and `## Notes`), the consumer guessed by matching substrings of the
displayed prose in the recorded output.

This led to four confirmed failure modes (#160, obsidian-chain-runner #139):
1. Editing Notes in `## Pitch\nOriginal pitch.\n\n## Notes\nOriginal notes.` replaced Pitch.
2. Editing both Pitch and Notes dropped one edit.
3. When Notes shared prose with Pitch, the first occurrence in Pitch was modified instead.
4. Editing an empty Notes section replaced the whole node output, obliterating Pitch.

Rebuilding whole outputs in the consumer violated the ownership principle established
in ADR-0001 and ADR-0017: the engine owns panel projection semantics.

## Decision

The engine owns addressed revisions and whole-output reconstruction:

1. **Panels carry socket address:** `LayoutPanel` carries `socket: string` (`'output'`
   when the port names no specific section, or the section path).

2. **Addressed fork revisions:** `revisions` in `POST /api/runs/:id/fork` accepts
   either a whole text string (retaining full backward compatibility) or an object
   mapping sockets to edits:
   ```json
   {
     "revisions": {
       "prop": {
         "pitch": { "text": "Edited pitch.", "was": "Original pitch." },
         "notes": "Edited notes."
       }
     }
   }
   ```

3. **Authoritative engine splicing:** `lib/revision.ts` splices each edit into the
   node's recorded output from the end of the heading line, preserving surrounding
   headings and unedited sections.

4. **Explicit safety and refusal semantics:**
   - **Staleness guard (`was`):** An edit can optionally specify `was`. If the recorded
     output no longer matches `was`, the engine refuses with `409 Conflict`.
   - **Missing section:** If a socket does not exist in the recorded output, the engine
     refuses with `422 Unprocessable`.
   - **Ambiguous headings:** If a section path matches multiple sibling headings at the
     same level, the engine refuses with `422 Unprocessable`.
   - **Section read-back integrity:** An edit cannot inject headings that would fragment
     the section or break panel extraction; attempted injections refuse with `422 Unprocessable`.
   - **Overlap:** Combining `output` with a specific section on the same node refuses with `400 Bad Request`.

5. **Capability discovery:** `GET /api/workspace` advertises `capabilities.addressedRevisions: true`.

## Consequences

- The Obsidian plugin (and any other client) no longer performs substring matching or
  whole-output reconstruction. It sends edits keyed by `(node, socket)`.
- Multiple panels from the same node can be edited simultaneously without collisions.
- Unedited sections and empty sections are preserved cleanly.
- Existing whole-text revisions continue to work without modification.
