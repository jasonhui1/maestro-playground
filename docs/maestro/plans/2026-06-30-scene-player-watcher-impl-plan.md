# Scene Player (Watcher) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an in-repo "Scene Player" — author two characters with a secret/goal and a forcing situation, hit run, and watch them collide turn-by-turn with collapsible private thoughts.

**Architecture:** A pure orchestration core (`runScene`) owns the turn-loop and the public Scene Log and takes an injected `runTurn`, mirroring how the chain executor injects `runFn`. A new SSE route wires `runTurn` to the existing `runAgent`. A new client page authors the scene and renders the streamed transcript. **The chain engine is not modified.**

**Tech Stack:** Next.js 16 (App Router, route handlers), React 19 (client component), the existing `openai`-based `runAgent`, `tsx` for unit tests.

## Global Constraints

- **No engine changes.** Do not modify `lib/executor.ts`, `lib/runner.ts`, `lib/chainGraph.ts`, or any chain type. The Scene Player only *calls* `runAgent`. (Spec §0, §11)
- **Next 16 / React 19.** Before writing any route handler or page, read `.agents/skills/nextjs16.md` if present (project convention) and follow its App-Router patterns.
- **No persistence.** Scenes and characters are in-memory only; do not write `workspace/agents/*.md` or run logs. (Spec §9, §10)
- **Two characters, fixed alternation, default 8 turns.** No director, no N>2. (Spec §5, §9)
- **Private thoughts:** characters emit reasoning inside `<thought>…</thought>`; `runAgent` already separates that channel. Thoughts are shown collapsibly and **never** enter the shared Scene Log. (Spec §3, §4, §5)
- **Tests:** match the existing `tests/*.test.ts` style — `import assert from 'node:assert'`, top-level (or `main()`) asserts, run a single file with `npx tsx tests/<file>.test.ts`. The full suite is `npm run test:run` (vitest).
- **Aesthetic:** reuse the existing zinc/white, monospace-for-content palette. (Spec §8)

## File Structure

- Create `lib/scene/types.ts` — `CharacterCard`, `Scene`, `TurnRecord`, `SceneEvent`. One file: these change together.
- Create `lib/scene/characterPrompt.ts` — `buildCharacterSystemPrompt(card)` + `TENSION_RULES`. Pure.
- Create `lib/scene/sceneRunner.ts` — `runScene`, `renderSceneLog`, `RunTurn`. Pure orchestration, injected runner.
- Create `tests/scene-character-prompt.test.ts`, `tests/scene-runner.test.ts`.
- Create `app/api/scene/route.ts` — POST → SSE; wires `runAgent` into `runScene`.
- Create `components/scene/SceneForm.tsx` — authoring inputs (two cards, situation, turns, model).
- Create `components/scene/TurnBlock.tsx` — one turn: speaker, collapsible thought, public line.
- Create `app/scene/page.tsx` — holds state, POSTs, consumes SSE, renders transcript.

---

### Task 1: Character system prompt (pure)

**Files:**
- Create: `lib/scene/types.ts`
- Create: `lib/scene/characterPrompt.ts`
- Test: `tests/scene-character-prompt.test.ts`

**Interfaces:**
- Produces: `CharacterCard { name, persona, secret, goal }`; `buildCharacterSystemPrompt(card: CharacterCard): string`; `TENSION_RULES: string[]`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/scene-character-prompt.test.ts
import assert from 'node:assert'
import { buildCharacterSystemPrompt } from '../lib/scene/characterPrompt'

const card = {
  name: 'Ser Aldric',
  persona: 'weathered, proud',
  secret: 'a wasting illness; his hands shake',
  goal: 'pass his sword to someone worthy tonight',
}
const p = buildCharacterSystemPrompt(card)

assert.ok(p.includes('Ser Aldric'), 'includes name')
assert.ok(p.includes('weathered, proud'), 'includes persona')
assert.ok(p.includes('a wasting illness'), 'includes secret')
assert.ok(p.includes('pass his sword to someone worthy'), 'includes goal')
assert.ok(p.includes('<thought>'), 'instructs the private-thought tag')
assert.ok(/protect your secret/i.test(p), 'includes a tension rule')

console.log('✅ scene character prompt tests passed')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/scene-character-prompt.test.ts`
Expected: FAIL — cannot find module `../lib/scene/characterPrompt`.

- [ ] **Step 3: Create the types**

```ts
// lib/scene/types.ts
export interface CharacterCard {
  name: string
  persona: string
  secret: string
  goal: string
}
```

- [ ] **Step 4: Implement the prompt builder**

```ts
// lib/scene/characterPrompt.ts
import { CharacterCard } from './types'

export const TENSION_RULES = [
  'Protect your secret: never state it outright; deflect if pressed.',
  'Pursue your goal relentlessly — let it drive every line.',
  'Escalate, do not resolve: raise the stakes; do not seek comfort or closure.',
  'Stay in character: no narrator voice, no breaking frame.',
]

export function buildCharacterSystemPrompt(card: CharacterCard): string {
  return [
    `You are ${card.name}.`,
    `Persona: ${card.persona}`,
    `Your private secret (you know it; the other character does not): ${card.secret}`,
    `Your goal in this scene: ${card.goal}`,
    'Rules:',
    ...TENSION_RULES.map(r => `- ${r}`),
    'Format every reply as: first your private thoughts wrapped in <thought>…</thought>, '
      + 'then ONE spoken line or small action in plain prose. '
      + "Write only your own beat — never write the other character's lines.",
  ].join('\n')
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx tests/scene-character-prompt.test.ts`
Expected: PASS — `✅ scene character prompt tests passed`.

- [ ] **Step 6: Commit**

```bash
git add lib/scene/types.ts lib/scene/characterPrompt.ts tests/scene-character-prompt.test.ts
git commit -m "feat(scene): character system prompt with tension rules"
```

---

### Task 2: Scene runner (pure orchestration)

**Files:**
- Modify: `lib/scene/types.ts` (add `Scene`, `TurnRecord`, `SceneEvent`)
- Create: `lib/scene/sceneRunner.ts`
- Test: `tests/scene-runner.test.ts`

**Interfaces:**
- Consumes: `CharacterCard` from Task 1.
- Produces:
  - `Scene { a: CharacterCard; b: CharacterCard; situation: string; turns: number }`
  - `TurnRecord { speaker: string; thought: string; line: string }`
  - `SceneEvent` (discriminated union, see code)
  - `RunTurn = (character, sceneLog, onToken) => Promise<{ thought; line }>`
  - `renderSceneLog(situation, transcript): string`
  - `runScene(scene, runTurn, onEvent): Promise<TurnRecord[]>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/scene-runner.test.ts
import assert from 'node:assert'
import { runScene, renderSceneLog, RunTurn } from '../lib/scene/sceneRunner'
import { Scene, SceneEvent } from '../lib/scene/types'

const scene: Scene = {
  a: { name: 'A', persona: '', secret: 'SECRET-A', goal: '' },
  b: { name: 'B', persona: '', secret: 'SECRET-B', goal: '' },
  situation: 'snowed in',
  turns: 4,
}

async function main() {
  const order: string[] = []
  const logsSeen: string[] = []
  const stub: RunTurn = async (c, log) => {
    order.push(c.name)
    logsSeen.push(log)
    return { thought: `t-${c.name}`, line: `say-${c.name}-${order.length}` }
  }

  const events: SceneEvent[] = []
  const transcript = await runScene(scene, stub, e => events.push(e))

  assert.deepStrictEqual(order, ['A', 'B', 'A', 'B'], 'alternates A/B for 4 turns')
  assert.strictEqual(transcript.length, 4, 'one record per turn')
  assert.strictEqual(transcript[0].thought, 't-A', 'captures private thought')
  assert.strictEqual(transcript[0].line, 'say-A-1', 'captures public line')

  // The shared log passed to each turn must NOT contain either secret.
  assert.ok(!logsSeen.some(l => l.includes('SECRET-A') || l.includes('SECRET-B')),
    'secrets never enter the shared scene log')
  // The log grows: turn 2 sees turn 1's public line; turn 1 sees the situation.
  assert.ok(logsSeen[0].includes('snowed in'), 'situation seeds the log')
  assert.ok(logsSeen[1].includes('say-A-1'), 'later turns see earlier public lines')

  const done = events.find(e => e.type === 'scene-done')
  assert.ok(done && done.type === 'scene-done' && done.transcript.length === 4, 'scene-done carries transcript')
  assert.strictEqual(events.filter(e => e.type === 'turn-done').length, 4, 'one turn-done per turn')

  console.log('✅ scene runner tests passed')
}
main().catch(err => { console.error(err); process.exit(1) })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/scene-runner.test.ts`
Expected: FAIL — cannot find module `../lib/scene/sceneRunner`.

- [ ] **Step 3: Extend the types**

Append to `lib/scene/types.ts`:

```ts
export interface Scene {
  a: CharacterCard
  b: CharacterCard
  situation: string
  turns: number // default 8
}

export interface TurnRecord {
  speaker: string // character name
  thought: string // private — shown collapsibly, never in the shared log
  line: string    // public — appended to the Scene Log
}

export type SceneEvent =
  | { type: 'situation'; text: string }
  | { type: 'turn-start'; index: number; speaker: string }
  | { type: 'token'; index: number; speaker: string; token: string; channel: 'thought' | 'line' }
  | { type: 'turn-done'; index: number; record: TurnRecord }
  | { type: 'scene-done'; transcript: TurnRecord[] }
  | { type: 'error'; error: string }
```

- [ ] **Step 4: Implement the runner**

```ts
// lib/scene/sceneRunner.ts
import { Scene, CharacterCard, TurnRecord, SceneEvent } from './types'

// Injected per-turn runner. Given the speaking character and the PUBLIC scene log
// so far, produce that character's private thought and public line. The character's
// own secret/goal are injected by the caller (via its system prompt), never via `sceneLog`.
export type RunTurn = (
  character: CharacterCard,
  sceneLog: string,
  onToken: (token: string, channel: 'thought' | 'line') => void,
) => Promise<{ thought: string; line: string }>

export function renderSceneLog(situation: string, transcript: TurnRecord[]): string {
  const lines = [`[Situation] ${situation}`]
  for (const t of transcript) lines.push(`${t.speaker}: ${t.line}`)
  return lines.join('\n')
}

export async function runScene(
  scene: Scene,
  runTurn: RunTurn,
  onEvent: (e: SceneEvent) => void,
): Promise<TurnRecord[]> {
  const transcript: TurnRecord[] = []
  onEvent({ type: 'situation', text: scene.situation })

  for (let index = 0; index < scene.turns; index++) {
    const speaker = index % 2 === 0 ? scene.a : scene.b
    onEvent({ type: 'turn-start', index, speaker: speaker.name })

    const log = renderSceneLog(scene.situation, transcript)
    const { thought, line } = await runTurn(speaker, log, (token, channel) =>
      onEvent({ type: 'token', index, speaker: speaker.name, token, channel }))

    const record: TurnRecord = { speaker: speaker.name, thought, line }
    transcript.push(record)
    onEvent({ type: 'turn-done', index, record })
  }

  onEvent({ type: 'scene-done', transcript })
  return transcript
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx tests/scene-runner.test.ts`
Expected: PASS — `✅ scene runner tests passed`.

- [ ] **Step 6: Commit**

```bash
git add lib/scene/types.ts lib/scene/sceneRunner.ts tests/scene-runner.test.ts
git commit -m "feat(scene): pure scene runner with injected per-turn runner"
```

---

### Task 3: SSE API route

**Files:**
- Create: `app/api/scene/route.ts`

**Interfaces:**
- Consumes: `runAgent` (`lib/runner.ts:18`), `buildCharacterSystemPrompt` (Task 1), `runScene`/`RunTurn` (Task 2), `AgentDef` (`lib/types.ts`).
- Produces: `POST /api/scene` — body `{ scene: Scene; model: string }`; response is an SSE stream of `SceneEvent` JSON objects (`data: {…}\n\n`).

- [ ] **Step 1: Implement the route**

```ts
// app/api/scene/route.ts
import { NextRequest } from 'next/server'
import { runAgent } from '@/lib/runner'
import { AgentDef } from '@/lib/types'
import { Scene, CharacterCard } from '@/lib/scene/types'
import { buildCharacterSystemPrompt } from '@/lib/scene/characterPrompt'
import { runScene, RunTurn } from '@/lib/scene/sceneRunner'

// runAgent only reads `.model`, `.name`, `.max_tokens`; the rest is filler so the
// CharacterCard never has to be saved as a real workspace agent.
function ephemeralAgent(card: CharacterCard, model: string): AgentDef {
  return {
    slug: card.name, name: card.name, model, description: '',
    skills: [], context: [], input_from: 'user', output_format: 'markdown',
    outputs: [], inputs: [], systemPrompt: '', filePath: '',
  }
}

export async function POST(req: NextRequest) {
  const { scene, model } = (await req.json()) as { scene: Scene; model: string }
  if (!scene || !model) return new Response('scene and model are required', { status: 400 })

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`))

      const runTurn: RunTurn = async (card, sceneLog, onToken) => {
        const sys = buildCharacterSystemPrompt(card)
        const out = await runAgent(
          ephemeralAgent(card, model),
          sys,
          sceneLog,
          (token, type) => onToken(token, type === 'thought' ? 'thought' : 'line'),
        )
        if (out.status === 'error') throw new Error(out.error || 'agent error')
        return { thought: out.thought ?? '', line: out.output }
      }

      try {
        await runScene(scene, runTurn, send)
      } catch (err) {
        send({ type: 'error', error: err instanceof Error ? err.message : String(err) })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  })
}
```

- [ ] **Step 2: Verify manually (requires `AI_API_KEY` in `.env.local`)**

Start the app: `npm run dev`. In a second shell, run a 2-turn smoke test (pick a model id that exists in your workspace — see Task 4 for how the UI lists them):

```bash
curl -N http://localhost:3000/api/scene -H 'Content-Type: application/json' -d '{
  "model": "REPLACE_WITH_A_MODEL_ID",
  "scene": {
    "situation": "snowed in at a shuttered tavern; a sword on the table",
    "turns": 2,
    "a": { "name": "Aldric", "persona": "weathered, proud", "secret": "a wasting illness; his hands shake", "goal": "pass his sword to someone worthy without showing weakness" },
    "b": { "name": "Wren", "persona": "quick, charming, watchful", "secret": "she is Aldric's abandoned child and does not know it", "goal": "steal the sword" }
  }
}'
```

Expected: a stream of `data: {…}` lines — one `situation`, then per turn a `turn-start`, several `token` events (with `channel` `thought` then `line`), and a `turn-done`; finally `scene-done`. Confirm no `token` with `channel:"line"` contains either secret verbatim.

- [ ] **Step 3: Commit**

```bash
git add app/api/scene/route.ts
git commit -m "feat(scene): SSE route streaming a watched scene"
```

---

### Task 4: SceneForm component

**Files:**
- Create: `components/scene/SceneForm.tsx`

**Interfaces:**
- Consumes: `Scene`, `CharacterCard` (Task 2/1).
- Produces: `<SceneForm value models onChange onRun disabled />` where
  `value: { scene: Scene; model: string }`, `models: string[]`,
  `onChange(next)`, `onRun()`, `disabled: boolean`.

- [ ] **Step 1: Implement the form**

```tsx
// components/scene/SceneForm.tsx
'use client'
import { Scene, CharacterCard } from '@/lib/scene/types'

type Value = { scene: Scene; model: string }

function CardFields({ label, card, onChange, disabled }: {
  label: string; card: CharacterCard; disabled: boolean
  onChange: (c: CharacterCard) => void
}) {
  const field = (k: keyof CharacterCard, placeholder: string) => (
    <input
      value={card[k]} placeholder={placeholder} disabled={disabled}
      onChange={e => onChange({ ...card, [k]: e.target.value })}
      className="w-full text-sm border border-zinc-200 rounded px-2 py-1 mb-1 disabled:bg-zinc-50"
    />
  )
  return (
    <div className="flex-1">
      <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">{label}</div>
      {field('name', 'name')}
      {field('persona', 'persona — how they read')}
      {field('secret', 'secret — hidden from the other')}
      {field('goal', 'goal — what they want this scene')}
    </div>
  )
}

export function SceneForm({ value, models, onChange, onRun, disabled }: {
  value: Value; models: string[]; disabled: boolean
  onChange: (v: Value) => void; onRun: () => void
}) {
  const { scene, model } = value
  const set = (patch: Partial<Scene>) => onChange({ ...value, scene: { ...scene, ...patch } })
  return (
    <div className="border border-zinc-200 rounded-lg p-4 bg-zinc-50/50 space-y-3">
      <div className="flex gap-4">
        <CardFields label="Character A" card={scene.a} disabled={disabled} onChange={a => set({ a })} />
        <CardFields label="Character B" card={scene.b} disabled={disabled} onChange={b => set({ b })} />
      </div>
      <textarea
        value={scene.situation} placeholder="Situation — the forcing premise that traps them together"
        disabled={disabled} onChange={e => set({ situation: e.target.value })}
        className="w-full text-sm border border-zinc-200 rounded px-2 py-1 h-16 disabled:bg-zinc-50"
      />
      <div className="flex items-center gap-3">
        <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Turns</label>
        <input
          type="number" min={2} max={20} value={scene.turns} disabled={disabled}
          onChange={e => set({ turns: Math.max(2, Number(e.target.value) || 8) })}
          className="w-16 text-sm border border-zinc-200 rounded px-2 py-1 disabled:bg-zinc-50"
        />
        <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Model</label>
        <select
          value={model} disabled={disabled || models.length === 0}
          onChange={e => onChange({ ...value, model: e.target.value })}
          className="text-sm border border-zinc-200 rounded px-2 py-1 disabled:bg-zinc-50"
        >
          {models.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <button
          onClick={onRun} disabled={disabled || !model}
          className="ml-auto px-4 py-1.5 text-sm font-medium rounded-lg bg-zinc-900 text-white hover:bg-zinc-700 disabled:opacity-40"
        >
          Run scene
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/scene/SceneForm.tsx
git commit -m "feat(scene): scene authoring form"
```

---

### Task 5: TurnBlock + Scene page (end-to-end)

**Files:**
- Create: `components/scene/TurnBlock.tsx`
- Create: `app/scene/page.tsx`

**Interfaces:**
- Consumes: `SceneForm` (Task 4), `runScene` event shapes (Task 2), `POST /api/scene` (Task 3), `/api/workspace` (existing — returns `{ agents: AgentDef[] }`, used to list distinct models).
- Produces: route `/scene`.

- [ ] **Step 1: Implement TurnBlock (collapsible thought)**

```tsx
// components/scene/TurnBlock.tsx
'use client'
import { useState } from 'react'
import { ChevronRight } from 'lucide-react'

export function TurnBlock({ speaker, thought, line, streaming }: {
  speaker: string; thought: string; line: string; streaming?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mb-4">
      <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">{speaker}</div>
      {thought && (
        <button onClick={() => setOpen(o => !o)} className="flex items-start gap-1 text-left w-full mb-1 nodrag">
          <ChevronRight size={12} className={`mt-1 text-zinc-300 transition-transform ${open ? 'rotate-90' : ''}`} />
          {open
            ? <span className="text-xs italic text-zinc-400 font-mono whitespace-pre-wrap">{thought}</span>
            : <span className="text-[10px] uppercase tracking-widest text-zinc-300 mt-0.5">thought</span>}
        </button>
      )}
      <p className="text-sm text-zinc-800 font-mono whitespace-pre-wrap pl-4">
        {line}{streaming && <span className="animate-pulse">▍</span>}
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Implement the page**

```tsx
// app/scene/page.tsx
'use client'
import { useEffect, useRef, useState } from 'react'
import { AgentDef } from '@/lib/types'
import { Scene, TurnRecord, SceneEvent } from '@/lib/scene/types'
import { SceneForm } from '@/components/scene/SceneForm'
import { TurnBlock } from '@/components/scene/TurnBlock'

const DEFAULT_SCENE: Scene = {
  a: { name: 'Ser Aldric', persona: 'weathered, proud', secret: 'a wasting illness; his hands shake', goal: 'pass his sword to someone worthy tonight, without showing weakness' },
  b: { name: 'Wren', persona: 'quick, charming, watchful', secret: "she is Aldric's abandoned child and does not know it", goal: 'steal the sword' },
  situation: 'A blizzard. The two are alone in a shuttered tavern, a sword on the table between them.',
  turns: 8,
}

export default function ScenePage() {
  const [models, setModels] = useState<string[]>([])
  const [value, setValue] = useState<{ scene: Scene; model: string }>({ scene: DEFAULT_SCENE, model: '' })
  const [transcript, setTranscript] = useState<TurnRecord[]>([])
  const [live, setLive] = useState<{ speaker: string; thought: string; line: string } | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/workspace').then(r => r.json()).then((d: { agents?: AgentDef[] }) => {
      const distinct = Array.from(new Set((d.agents ?? []).map(a => a.model))).filter(Boolean)
      setModels(distinct)
      setValue(v => ({ ...v, model: v.model || distinct[0] || '' }))
    }).catch(() => setError('Failed to load models from workspace.'))
  }, [])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [transcript, live])

  async function run() {
    setRunning(true); setError(null); setTranscript([]); setLive(null)
    let cur = { speaker: '', thought: '', line: '' }
    try {
      const res = await fetch('/api/scene', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      })
      if (!res.ok) throw new Error(await res.text())
      const reader = res.body!.getReader()
      const dec = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value: chunk } = await reader.read()
        if (done) break
        buf += dec.decode(chunk, { stream: true })
        const lines = buf.split('\n'); buf = lines.pop() || ''
        for (const l of lines) {
          const t = l.trim()
          if (!t.startsWith('data: ')) continue
          const e = JSON.parse(t.slice(6)) as SceneEvent
          if (e.type === 'turn-start') { cur = { speaker: e.speaker, thought: '', line: '' }; setLive({ ...cur }) }
          else if (e.type === 'token') {
            if (e.channel === 'thought') cur.thought += e.token; else cur.line += e.token
            setLive({ ...cur })
          }
          else if (e.type === 'turn-done') { setTranscript(prev => [...prev, e.record]); setLive(null) }
          else if (e.type === 'scene-done') { setLive(null) }
          else if (e.type === 'error') { setError(e.error) }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false); setLive(null)
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-sm font-bold text-zinc-900 uppercase tracking-widest mb-4">Scene Player</h1>
      <SceneForm value={value} models={models} disabled={running} onRun={run}
        onChange={setValue} />
      {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
      <div className="mt-6">
        {transcript.map((t, i) => <TurnBlock key={i} {...t} />)}
        {live && <TurnBlock {...live} streaming />}
        <div ref={endRef} />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify manually — the first fun moment**

Run `npm run dev`, open `/scene`. The default Aldric/Wren scene is pre-filled.
- [ ] Pick a model and hit **Run scene**; turns stream in, alternating Aldric → Wren.
- [ ] Each turn shows a public line; clicking **thought** expands the private reasoning; collapse-all reads as inference-only, expand reads as omniscient.
- [ ] Confirm a spoken line never prints either secret verbatim.
- [ ] Edit Wren's secret (e.g., "she is here to kill Aldric for a bounty") and re-run — the scene should re-form materially differently.

- [ ] **Step 4: Commit**

```bash
git add components/scene/TurnBlock.tsx app/scene/page.tsx
git commit -m "feat(scene): scene page with streamed transcript and collapsible thoughts"
```

---

## Self-Review

**Spec coverage:**
- §2 first fun moment → Task 5 default scene + manual verification.
- §3 vocabulary (Scene/CharacterCard/Scene Log/Turn/Thought) → Tasks 1–2 types + `renderSceneLog`.
- §4 anti-generic tension rules → Task 1 `TENSION_RULES` (in the system prompt).
- §5 app owns loop+log, engine = per-character runner, thought via existing channel → Task 2 (`runScene`) + Task 3 (wires `runAgent`, maps `output`→`line`).
- §6 data shapes → Tasks 1–2 types.
- §7 engine contract / ephemeral agent → Task 3 `ephemeralAgent`.
- §8 UI (form, run, collapsible thoughts, edit-and-rerun) → Tasks 4–5.
- §9 out of scope → respected (no director, no N>2, no persistence, no files).
- §11 success criteria → Task 5 Step 3 checklist; "no engine change" → Global Constraints + no engine file in any task.

**Placeholder scan:** the only literal placeholder is `REPLACE_WITH_A_MODEL_ID` in Task 3's curl, which is intentional (the model id is environment-specific; Task 4/5 list real ones from `/api/workspace`). No other TBDs.

**Type consistency:** `CharacterCard`, `Scene`, `TurnRecord`, `SceneEvent`, `RunTurn`, `renderSceneLog`, `runScene`, `buildCharacterSystemPrompt`, `ephemeralAgent` are used with identical signatures across tasks. `SceneEvent.token` carries `channel: 'thought' | 'line'`; the route maps `runAgent`'s `'output'` → `'line'` consistently.

## Notes for the implementer
- The two pure modules (Tasks 1–2) are the only unit-tested parts, matching this repo's convention (routes/pages are verified by running the app). Do not add a test framework.
- If `/api/workspace` returns no agents (empty workspace), the model dropdown is empty and **Run** stays disabled — seed at least one agent first, or temporarily hardcode a known model id in `DEFAULT_SCENE`’s sibling state for smoke-testing.
