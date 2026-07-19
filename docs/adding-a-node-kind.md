# Adding a new node kind

Since the node-kind registry series (#2–#9), a node kind's **facts** live in one place: `lib/nodeKinds.ts`. Adding a kind is a small, mostly compiler-guided change — the type system refuses to compile until the required pieces exist.

Read [ADR-0001](adr/0001-node-kind-registry-holds-facts-not-behaviour.md) first: **the registry holds facts, not behaviour.** Fields, sockets, and palette data go in the descriptor; runtime behaviour stays in the executor's dispatch. Never add an `execute()` to a descriptor.

## The three tiers

When you add a kind, edits fall into three buckets:

| Tier | What | Where |
|---|---|---|
| **Compiler-enforced** | Won't build until you do it | `ChainNodeKind` + `ChainNode` union, registry entry, `nodeTypes` map |
| **Manual** | Compiles without it, but the kind won't *work* | Executor dispatch arm (only if the kind has runtime behaviour), the node component itself |
| **Auto-derived** | You get it for free from the descriptor | serialize/parse, palette, socket rendering, validation capabilities |

The auto-derived tier is the whole point of the registry: define the descriptor's `fields` and `palette`, and persistence + the palette + socket wiring follow with no extra edits.

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

Each component renders exactly one kind. Narrow `data.node` with `NodeOfKind<'note'>` — the cast is sound because the `nodeTypes` map (step 4) guarantees which kind reaches which component.

```tsx
import type { EditorNodeData, NodeOfKind } from '../nodeData'

function NoteNode({ data }: NodeProps<Node<EditorNodeData>>) {
  const node = data.node as NodeOfKind<'note'>
  return (/* … render node.text, call data.onChange({ text }) … */)
}
```

### 4. Register the component — `components/editor/ChainCanvas.tsx`

`nodeTypes` is typed `Record<ChainNodeKind, …>`, so **this file also won't compile until `note` is registered.**

```ts
const nodeTypes = { /* … */ report: ReportNode, note: NoteNode, zoneFrame: ZoneFrame }
```

### 5. (Only if it has behaviour) add an executor dispatch arm — `lib/executor.ts`

Per ADR-0001, behaviour lives here, not in the descriptor. The dispatch is an `if / else-if` chain on `node.kind` (~line 213+). **It is not exhaustiveness-checked** — a kind that matches no arm silently does nothing and leaves its out-edges dead.

- **Pure source / passthrough** (like `seed`/`context`): add to the early `markOut(nodeId, () => true)` arm so downstream stays live.
- **Display-only, no outputs** (our `note`): no arm needed — it has no out-edges to keep alive.
- **Real behaviour** (gate/branch/subchain-style): add an `else if (node.kind === 'note')` arm.

## Checklist

- [ ] `ChainNodeKind` string + `ChainNode` union variant (fields match the descriptor)
- [ ] `registry` descriptor in `lib/nodeKinds.ts` (compiler-forced)
- [ ] `XxxNode.tsx` component, narrowed with `NodeOfKind<'xxx'>`
- [ ] Register in `nodeTypes` map (compiler-forced)
- [ ] Executor dispatch arm — only if the kind has runtime behaviour
- [ ] `tsc` clean; add/extend a test (assert-on-import script: `npx tsx tests/<file>.test.ts`)

## Concept list

- **Descriptor** — the registry entry for a kind: its facts (`fields`, `inputs`/`outputs` sockets, `palette`). No behaviour.
- **Field codec** — how a persisted field serializes/parses (`string`/`number`/`stringList`/`cases`). Drives round-tripping automatically.
- **`ChainNodeBase`** — shared fields on every node (`id`, `pos`, `zone`). Never restated on a variant.
- **`NodeOfKind<K>`** — narrows the `ChainNode` union to one variant in a component (`components/editor/nodeData.ts`).
- **Compiler-forced vs manual** — the `Record<ChainNodeKind, …>` types (registry, `nodeTypes`) fail to compile until their entry exists; the executor dispatch does not, so it's the one arm you must remember by hand.
