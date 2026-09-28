# Image generation tool (NovelAI)

An agent can call a `novelai` tool mid-node to draw a picture. The engine saves
the picture as WebP in the run folder and attaches it to the node's output, so
it shows in Maestro, in the run log, and — downloaded into the vault — in
Obsidian.

## What the user sees

```
chain: writer ──▶ …                      writer's tools: [novelai]

writer calls novelai({ character: "1girl", clothes: "red cloak", scene: "lighthouse, storm", aspect: "2:3" })
        │
        ▼
workspace/logs/<runId>/images/img-k3f9x2ab.webp        ← saved, WebP q90

writer output (what the next node receives, and the log):
  The lighthouse stood against the storm…

  ## Images

  ![](/api/runs/<runId>/images/img-k3f9x2ab.webp)
```

In Obsidian the output note becomes:

```
<output folder>/<runId>/
  01-writer.md           … ## Images  ![[images/img-k3f9x2ab.webp]]
  images/img-k3f9x2ab.webp
```

## Settings — who decides what

| Setting            | Decided by                         | Where                                        |
| ------------------ | ---------------------------------- | -------------------------------------------- |
| prompt parts       | wire / node literal / default / agent | tool file `parts` (see Prompt parts)      |
| aspect             | agent, per call                    | tool param `aspect`: `2:3` · `3:2` · `1:1`   |
| model              | tool file                          | `config.model`, else `IMAGE_MODEL`           |
| size               | global, plugin may override        | `IMAGE_SIZE`: `normal` · `small`             |
| quality tags       | global, plugin may override        | `IMAGE_QUALITY` (appended to the prompt)     |
| negative prompt    | global, plugin may override        | `IMAGE_NEGATIVE`                             |
| sampler            | global                             | `IMAGE_SAMPLER` (default `k_euler_ancestral`) |
| noise schedule     | global                             | `IMAGE_NOISE_SCHEDULE` (default `karras`)    |
| steps              | global                             | `IMAGE_STEPS` (default `28`, 1-50)           |
| guidance           | global                             | `IMAGE_GUIDANCE` (default `5`, 0-10)         |
| cfg rescale        | global                             | `IMAGE_CFG_RESCALE` (default `0`, 0-1)       |
| Variety+           | global (none on v5)                | `IMAGE_VARIETY` (default `false`)            |
| seed               | tool file                          | `config.seed`, else random per call          |

Sizes (all within NovelAI's Opus free-generation limit):

```
            2:3          3:2          1:1
normal   832×1216     1216×832     1024×1024
small    512×768      768×512      640×640
```

Models: `nai-diffusion-4-full`, `nai-diffusion-4-5-full`, `nai-diffusion-5-full`.

Env (`.env.local`):

```
IMAGE_API_KEY=<NovelAI persistent API token>
IMAGE_BASE_URL=https://image.novelai.net
IMAGE_MODEL=nai-diffusion-4-5-full
IMAGE_SIZE=normal
IMAGE_QUALITY=very aesthetic, masterpiece, no text
IMAGE_NEGATIVE=lowres, bad anatomy, bad hands, watermark
IMAGE_SAMPLER=k_euler_ancestral
IMAGE_NOISE_SCHEDULE=karras
```

## Engine contract (maestro-playground)

- **Tool file** `workspace/tools/novelai.md`, `executor: novelai`. Param
  `aspect` (string, `enum: [2:3, 3:2, 1:1]`) and parts `character`, `clothes`,
  `scene` (see Prompt parts). A tool file without parts takes a `prompt` param.
  Tool params gain an optional `enum`, carried into the model-facing JSON Schema.
- **Image URL** — `GET /api/runs/:runId/images/:name` serves a saved image
  (`image/webp`). Names are `img-<id>.webp`; anything else is 404.
- **Auto-attach** — each successful image call is recorded on its tool call
  (`ToolCallRecord.images`: engine-relative URLs). The node's output gains a
  trailing `## Images` section listing every image not already linked in it.
- **Run override** — `POST /api/run` accepts
  `imageOverride: { size?: 'normal' | 'small', quality?: string, negative?: string }`.
  It is stored on `RunMeta.imageOverride`; any field it leaves out falls back to
  env. Forks, resumes, rerolls and node chats carry the run's override on; only a
  launch sets it.
- **Capability** — `GET /api/workspace` reports `capabilities.runImages: true`.
- NovelAI allows one generation at a time per account, so the engine queues
  image calls in-process rather than letting parallel nodes collide.
- A failed generation (no key, NovelAI error, timeout) is an ordinary tool
  error result: the agent sees the message and carries on.

## Prompt parts (#149)

A tool file may split its prompt into ordered, named `parts`:

```yaml
parts:
  character:                 # open: the agent writes it
  clothes: red cloak         # default
  scene:
    description: Pose, action and setting, as tags.
```

Each part is an optional input socket on every agent/decider node whose agent
uses the tool, named `<tool>.<part>` (drawn `novelai · character`):

```
┌──────────────────────────────┐
│ painter                      │
● input                        │
● novelai · character   ◀──── [designer].output   (wired)
○ novelai · clothes    [kimono]                  (literal on node)
○ novelai · scene      [unset]                   (open → agent)
└──────────────────────────────┘
```

A part's value, first match wins: wired edge → node literal → tool default →
the agent writes it per call. The agent's tool schema carries only open parts,
so a fixed part is locked. The NovelAI prompt is the parts in declared order,
then the quality tags. A node's wired and literal values are recorded on its
output (`fixedParts`, step log `fixed_parts`), so a reroll or node chat draws
with the same parts. Agent chat outside a chain has no node: defaults and the
agent only.

## Plugin contract (obsidian-chain-runner)

- **Download on write** — when an output note is written, every
  `![…](/api/runs/<runId>/images/<name>)` link is fetched from the engine into
  `<output folder>/<runId>/images/<name>` and rewritten to
  `![[images/<name>]]`. An image already in the vault is not fetched again.
- **Live views** — result, compare and directing views render node output
  before any note exists; there an engine-relative image link resolves against
  the engine URL setting.
- **Settings** — three optional fields (size, quality tags, negative prompt).
  Blank means "use the engine's env". Filled fields are sent as `imageOverride`
  on launch when the engine reports `runImages`.
