# Adding a new node kind

Since the node-kind registry series (#2–#9), a node kind's **facts** live in one place: `lib/nodeKinds.ts`. Adding a kind is a small, compiler-guided change — the type system refuses to compile until every wiring site exists and is correct. What it can't write for you is the *content*: the component's UI and (if any) the executor's behaviour.

Read [ADR-0001](adr/0001-node-kind-registry-holds-facts-not-behaviour.md) first: **the registry holds facts, not behaviour.** Fields, sockets, and palette data go in the descriptor; runtime behaviour stays in the executor's dispatch. Never add an `execute()` to a descriptor.

## The three tiers

When you add a kind, the work falls into three buckets:

| Tier | What | Where |
|---|---|---|
| **Compiler-enforced** | Won't build until you do it | `ChainNodeKind` + `ChainNode` union, registry entry, `nodeTypes` map entry (bound to the right component), executor dispatch arm |
| **Manual content** | Wiring is forced, but you write the actual code | the component's rendering body; the dispatch arm's behaviour |
| **Auto-derived** | Free from the descriptor | serialize/parse, palette, socket rendering, validation capabilities |

The compiler now walks you to *every* wiring site — miss one and it won't build, and a mis-wire (right key, wrong component) is a type error too. The auto-derived tier is the payoff of the registry: define the descriptor's `fields` and `palette`, and persistence + the palette + socket wiring follow with no extra edits.

## Worked example: adding a `note` kind

Say we want a display-only annotation node with one persisted field `text`, no sockets, no runtime behaviour.

### 1. Declare the kind and its shape — `lib/types.ts`

Add the string to `ChainNodeKind`, then add a variant to the `ChainNode` union. **The variant's kind-specific fields must match the descriptor's `fields` list** (step 2) — that is the invariant #9 enforces.

```ts
// before
export type ChainNodeKind = 'seed' | 'context' | /* … */ | 'report'

// after
export type ChainNodeKind = 'seed' | 'context' | /* … */ | 'report' | 'note'
```

```ts
// add to the ChainNode union (id/pos/zone come from ChainNodeBase — never restate them)
  | (ChainNodeBase & { kind: 'note'; text?: string })
```

> `id`, `pos`, and `zone` live on `ChainNodeBase`, never on a variant. `zone` is cross-kind loop membership; the serializer tiers it with `pos`, above the field-codec loop. Don't add `zone` to a variant or to a descriptor's `fields`.

### 2. Add the descriptor — `lib/nodeKinds.ts`

`registry` is typed `Record<ChainNodeKind, NodeKindDescriptor>`, so **the moment you add `'note'` to `ChainNodeKind`, this file won't compile until the entry exists.** That is the compiler herding you here.

```ts
  note: {
    kind: 'note',
    acceptsInputs: false,
    inputs: () => [],
    outputs: () => [],
    fields: [{ key: 'text', codec: 'string' }],   // must match the union variant
    palette: { label: 'Note', category: 'Annotation' },
  },
```

`fields` codecs (`string | number | stringList | cases`) drive serialize/parse automatically. `palette` (optional) makes it appear in the NodePalette. If a field needs a codec that doesn't exist yet, add it to `FieldCodec` and handle it in both `serializeFieldValue` (serializeChain) and `coerceField` (parseChain).

### 3. Add the canvas component — `components/editor/nodes/NoteNode.tsx`

Each component renders exactly one kind. **Declare that kind in the props** via `EditorNodeDataOf<'note'>` — then `data.node` arrives already narrowed to the `note` variant (no cast), and step 4 can compiler-check that this component is registered under `'note'`.

```tsx
import type { EditorNodeDataOf } from '../nodeData'

function NoteNode({ data }: NodeProps<Node<EditorNodeDataOf<'note'>>>) {
  const { node } = data                      // node: NodeOfKind<'note'> — text is in scope
  return (/* … render node.text, call data.onChange({ text }) … */)
}
```

A component may render more than one kind — `AgentNode` uses `EditorNodeDataOf<'agent' | 'decider'>` and is registered under both.

### 4. Register the component — `components/editor/ChainCanvas.tsx`

`nodeTypes` is keyed by a mapped type `{ [K in ChainNodeKind]: ComponentType<…EditorNodeDataOf<K>…> }`, which enforces **two** things at compile time: every kind must have an entry (miss `note` and it won't build), and each entry must be *that kind's* component (write `note: GateNode` and it's a type error, because `GateNode` declares `EditorNodeDataOf<'gate'>`).

```ts
const nodeTypes: KindComponents & { zoneFrame: … } = {
  /* … */ report: ReportNode, note: NoteNode, zoneFrame: ZoneFrame,
}
```

### 5. Add an executor dispatch arm — `lib/executor.ts`

Per ADR-0001, behaviour lives here, not in the descriptor. The dispatch is an `if / else-if` chain on `node.kind` (~line 213+), closed by a `never` default — so **forgetting an arm is now a compile error**, but what the arm *does* is yours to write.

- **Pure source / passthrough** (like `seed`/`context`): add to the early `markOut(nodeId, () => true)` arm so downstream stays live.
- **Display-only, no outputs** (our `note`): it still needs to satisfy the exhaustiveness check — the simplest arm is a no-op (it has no out-edges to keep alive). Sitting in no arm won't compile.
- **Real behaviour** (gate/branch/subchain-style): add an `else if (node.kind === 'note')` arm with the logic.
- Note: `loop-start`/`loop-end` are consumed earlier by `runZone`/`zonesByStart` and reach the dispatch only if malformed (zoneless); they share one explicit no-op arm.

## Checklist

- [ ] `ChainNodeKind` string + `ChainNode` union variant (fields match the descriptor)
- [ ] `registry` descriptor in `lib/nodeKinds.ts` (compiler-forced)
- [ ] `XxxNode.tsx` component typed `EditorNodeDataOf<'xxx'>` (no cast)
- [ ] Register in the `nodeTypes` map (compiler-forced; mis-wire is a type error)
- [ ] Executor dispatch arm (compiler-forced by the `never` default; write a no-op if there's no behaviour)
- [ ] `tsc` clean; add/extend a test (`node:assert` inside a vitest `test()`: `npx vitest run tests/<file>.test.ts`)

## Concept list

- **Descriptor** — the registry entry for a kind: its facts (`fields`, `inputs`/`outputs` sockets, `palette`). No behaviour.
- **Field codec** — how a persisted field serializes/parses (`string`/`number`/`stringList`/`cases`). Drives round-tripping automatically.
- **`ChainNodeBase`** — shared fields on every node (`id`, `pos`, `zone`). Never restated on a variant.
- **`NodeOfKind<K>` / `EditorNodeDataOf<K>`** — narrow the `ChainNode` union (or the editor data carrying it) to one kind. A component types its props with `EditorNodeDataOf<K>` to declare which kind it renders (`components/editor/nodeData.ts`).
- **Compiler-forced vs manual content** — every wiring site (union, registry, `nodeTypes` binding, executor arm) fails to compile until it exists and is correct; what the compiler can't supply is the component's UI and the arm's behaviour.
