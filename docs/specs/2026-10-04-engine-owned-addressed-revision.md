# Engine-owned addressed revision of projected output panels (#160)

`GET /api/workspace` advertises `capabilities.addressedRevisions: true`.
This capability covers `LayoutPanel.socket` in layout models and addressed edits in `POST /api/runs/:id/fork`.
The linked Obsidian consumer work is [obsidian-chain-runner#139](https://github.com/jasonhui1/obsidian-chain-runner/issues/139).

## Problem and Context

When a chain's declared view projects multiple output ports from a single node (e.g. `Pitch` on socket `pitch` and `Notes` on socket `notes`), the engine outputs layout panels. Previously, `LayoutPanel` carried only `node` and not `socket`.

When the user edited a proposal panel in Obsidian, `rerun.ts` had to guess the whole-output reconstruction by searching for the first substring match of the displayed text in the recorded output. This caused four failure modes:
1. Editing `Notes` replaced `Pitch` when `Pitch` appeared earlier in the output.
2. Editing both `Pitch` and `Notes` retained only one edit.
3. Identical prose between sections resulted in the wrong section being rewritten.
4. Editing an empty `Notes` panel wiped out the rest of the node's output.

Under ADR-0001 and ADR-0017, the engine owns panel projection semantics. Therefore, the engine must also own safe whole-output reconstruction from addressed edits.

## Core Concepts & Jargon

- **Address**: A pair `(node, socket)` identifying a panel's data source.
  - `node`: The node ID in the chain DAG.
  - `socket`: The specific output socket or markdown section path (e.g. `pitch`, `act-2/scene-3`, or `output` for full output).
- **Addressed Edit**: A mutation targeted to a specific socket on a node, rather than rewriting the node's entire output string.
- **Splice**: Replacing the body of a markdown heading while preserving heading syntax, surrounding whitespace, and unedited sibling sections.
- **Staleness Guard (`was`)**: An optional field carrying the exact text displayed to the user when the edit was initiated. If the engine's recorded output for that socket does not match `was`, the edit is refused with 409 Conflict.
- **Read-Back Integrity**: Verification that an edited section will still be extracted as a single coherent section without introducing new headings that would alter layout projection.

## Protocol and Specification

### 1. Layout Projection (`LayoutPanel`)

Every `LayoutPanel` emitted in layout frames and returned by `GET /api/runs/:id/layout` includes `socket`:

```typescript
export interface LayoutPanel {
  name: string
  node: string
  socket: string // 'output' for whole text, or section name/path (e.g. 'pitch')
  text: string
  lines: number
  state: PanelState
  emphasis?: 'last' | 'join'
  error?: string
  round?: number
  dice?: DiceRoll
}
```

### 2. Fork Request (`POST /api/runs/:id/fork`)

`revisions` accepts either legacy full-text strings or addressed edit maps:

```jsonc
{
  "revisions": {
    // Legacy full-text revision
    "proposer": "Full replacement text",

    // Addressed revision for a multi-socket node
    "director": {
      "pitch": "Updated pitch text.",
      "notes": {
        "text": "Updated notes text.",
        "was": "Original notes text." // Optional staleness check
      }
    }
  }
}
```

### 3. Refusal Semantics

- **400 Bad Request**:
  - `revisions` format is invalid.
  - An edit mixes `output` and specific section sockets for the same node.
  - Duplicate socket aliases targeting the same section.
  - Empty revision object.
  - The node is a `hold` or inside a `zone` loop.
  - The node exists in the run graph but has no recorded output in this run.
- **404 Not Found**: Node ID does not exist in the run graph.
- **409 Conflict**: An edit includes `was` and the current recorded output does not match `was`.
- **422 Unprocessable Entity**:
  - Target section heading does not exist in the recorded output.
  - Target heading is ambiguous (multiple headings match the slug within the candidate scope).
  - Two distinct socket paths resolve to the same section heading.
  - An addressed edit injects markdown headings that break section read-back integrity.

## Before and After Comparison

### Example: Multi-Panel Editing

Recorded node output:
```markdown
## Pitch
Original pitch.

## Notes
Original notes.
```

#### Before
Consumer attempts substring replacement:
- Input: Edit `Notes` to `"Edited notes."`.
- Consumer uses `indexOf("Original notes.")` or substitutes the first panel.
- Result: If the consumer selects the first panel or matches text in Pitch, Pitch is overwritten:
```markdown
## Pitch
Edited notes.

## Notes
Original notes.
```

#### After
Consumer sends addressed edit:
```json
{
  "revisions": {
    "prop": {
      "notes": "Edited notes."
    }
  }
}
```
Engine splices specifically into the `## Notes` section:
```markdown
## Pitch
Original pitch.

## Notes
Edited notes.
```

### Example: Editing Empty Section

Recorded node output:
```markdown
## Pitch
Original pitch.

## Notes
```

#### Before
- `indexOf("")` matches index 0 or fails; consumer replaces entire text with `"New notes."`.
- Result: `## Pitch` is lost.

#### After
- Engine locates the `## Notes` heading and splices under it.
- Result:
```markdown
## Pitch
Original pitch.

## Notes
New notes.
```

## Shared Fixtures

The shared test fixture is located at `tests/fixtures/addressed-revision.json` and defines 21 canonical cases covering:
- Issue cases 1 to 4 (multi-panel, concurrent edits, repeated bodies, empty bodies).
- Nested section paths.
- Staleness checking via `was`.
- Ambiguous and missing heading refusals.
- Injected heading refusal.
- Overlapping edit refusals.
