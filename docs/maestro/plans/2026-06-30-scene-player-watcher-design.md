---
design_depth: standard
task_complexity: medium
topic: scene-player-watcher
date: 2026-06-30
---

# Design: Scene Player — a watcher for engineered character collisions

## 0. Context

A new **in-repo surface** (a page + an API route inside this Next app) — a "toy"
layered on top of the existing chain engine. There is no external app; it lives in
this codebase and calls the engine server-side. The engine (nodes/edges DAG, loops,
agents, the `{}` resolver) is treated as **infrastructure and reused unchanged** —
the Scene Player calls `runAgent` as a per-character runner and adds nothing to it.

This is the first deliverable of a deliberate pivot. For its single user, the
project's value is **entertainment / taste-discovery**, not production tooling.
The convergent "refine loop" tooling that was previously the focus is mostly
built; it is **parked as backlog** (§9) and re-enabled only when a target taste
exists to refine toward.

## 1. Problem

LLM stories regress to the mean → "generic." You cannot refine toward a taste you
cannot name, and the user has never written, so they cannot specify the target.
The previous order — *refine, then discover* — is backwards.

This toy reorders it to **discover, then refine.** Interestingness emerges from
the **collision** between characters, not from any single agent being "good." A
simulation lets the user **recognize** what they like ("oh — *that*") instead of
having to **specify** it up front. The Scene Player is that discovery machine in
its simplest watchable form: **one scene, two characters, you read.**

## 2. The first fun moment (the success target)

What the user authors — three knobs per character plus the pressure:

- **Ser Aldric** (knight) — *persona:* weathered, proud. *secret:* a wasting
  illness; his hands shake. *goal:* pass his sword Dawnedge to someone worthy
  tonight, without anyone seeing he is weak.
- **Wren** (thief) — *persona:* quick, charming, watchful. *secret:* she is
  Aldric's abandoned child and **does not know it.** *goal:* steal Dawnedge.
- **Situation:** a blizzard; the two alone in a shuttered tavern; Dawnedge on the
  table between them.

What the user watches — public lines always visible, each character's private
thought collapsible:

> **Aldric** — *[hands won't stop. If she sees, she knows. Keep them down. Is she
> worth Dawnedge?]*
> "Sit. Nobody's getting through that snow tonight."
>
> **Wren** — *[one hand hidden — drunk or armed. The sword's right there. Keep him
> easy.]*
> "Beautiful blade. Heirloom — or did you take it off someone who stopped needing it?"

The fun moment: **a father auditioning his own child to inherit the sword she
plans to steal — and neither knows. The watcher does.** No dialogue was written
by the user; they arranged a collision and the irony fell out.

**The toy succeeds when running a well-authored Scene reliably produces a beat of
dramatic irony the user did not script and recognizes as interesting** — and
when changing one secret visibly re-forms the whole scene.

## 3. Core concepts (vocabulary)

- **Scene** — the unit you author and run: two Character Cards + a Situation.
- **Character Card** — `{ persona, secret, goal }` plus the **tension rules** (§4).
  Maps onto an engine agent: persona → system prompt; secret + goal injected privately.
- **Situation** — the forcing premise that traps the characters together.
- **Scene Log** — the public transcript. Owned by the **app**. Grows one line per turn.
- **Turn** — the app runs one Character against the current Scene Log and gets back
  a **public line** (enters the log) and a **private thought** (shown collapsibly,
  never enters the log).
- **Thought** — a character's private reasoning. Visible to the watcher (collapsible),
  invisible to the other character.

## 4. The anti-generic mechanism (make-or-break)

LLMs default to **harmony** — left alone the two characters turn warm, resolve by
turn three, and the tension dies. That is the cousin of "generic," and **v1 lives
or dies here.** The fix is prompt craft, not code: every Character Card carries
four **tension rules**, injected after the persona:

1. **Protect your secret** — never reveal it; deflect if pressed.
2. **Pursue your goal** — relentlessly, in every line.
3. **Escalate, do not resolve** — raise the stakes; do not seek comfort or closure.
4. **Stay in character** — no narrator voice, no breaking frame.

The two other levers are structural, not promptable:
- **Asymmetric secrets** → dramatic irony (the watcher knows what the characters do not).
- **A forcing situation** → no character can simply walk away.

## 5. Architecture

**The app owns the turn-loop and the Scene Log. The engine is an unchanged
per-character runner.** Because the app owns the log, the engine never sees shared
mutable state — each turn it receives the log as ordinary `{input}` for a single
agent call.

One turn, as data:

```
Scene Log (so far)
   └─► build system prompt = persona + secret + goal + tension rules
   └─► run ONE character agent  (input = Scene Log)
         └─► thought  → collapsible block (NOT appended to log)
         └─► line     → appended to Scene Log
```

The loop:

```
log = [Situation]
for turn in 0..N-1:
    speaker = turn even ? A : B
    sys     = buildSystemPrompt(speaker)        # persona + secret + goal + rules
    {thought, line} = runCharacter(sys, render(log))   # streams two channels
    append {speaker, thought, line} to transcript
    append "<speaker>: <line>" to log
render transcript
```

`N` is fixed (default 8) for v1. A "director" that decides who speaks and when to
cut is explicitly out of scope (§9).

## 6. Data shapes (app-side)

```ts
interface CharacterCard { name: string; persona: string; secret: string; goal: string }
interface Scene { a: CharacterCard; b: CharacterCard; situation: string; turns: number }  // turns default 8
interface TurnRecord { speaker: string; thought: string; line: string }   // thought private, line public
```

These live in the toy app only — they are **not** persisted as `workspace/agents/*.md`
files (§10).

## 7. The engine contract (what the toy needs from the engine)

The toy needs exactly one capability: **run a single character for one turn,
streaming back two separable channels.**

- Build the system prompt from the Character Card (persona + secret + goal +
  tension rules), inject the always-on base skills as today.
- Run one agent with the rendered Scene Log as the user message.
- Return the character's reasoning as **thought** and spoken line as **output**.

This maps directly onto the existing single-agent runner — `runAgent(agent,
systemPrompt, userMessage, onToken)` (`lib/runner.ts`; called this way at
`lib/executor.ts:95`) — which **already separates the two channels**: `onToken`
carries a `type: 'thought' | 'output'`, and `AgentOutput.thought` is a first-class
field. **No engine change is required to get private thoughts.**

The exact transport (reuse the existing chat SSE route vs. a thin new
`/api/scene/turn` route) is an implementation-plan detail, not a design decision.

## 8. UI

- **Authoring:** a form for the Scene — two Character Cards (name, persona, secret,
  goal) and the Situation. Plus a turn-count field (default 8).
- **Run:** one button. Streams the scene as it plays.
- **Transcript:** one block per turn — the **public line always visible**, the
  **thought in a collapsed disclosure**. Collapse-all = "infer it yourself" mode;
  expand = "omniscient" mode; the watcher toggles freely, even mid-scene.
- **Iterate:** edit a secret/goal and re-run to watch the scene re-form. (This is
  the core taste-discovery action — make it one click.)
- Aesthetic: reuse the existing zinc/white, monospace-for-content palette.

## 9. Out of scope (YAGNI — parked as backlog)

- A **director** agent (who-speaks / when-to-cut); fixed alternation instead.
- **More than two** characters.
- **Player / interactive** mode (the user *in* the scene) — the deferred fork.
- **Saving** characters or scenes as workspace files; in-app + throwaway for now.
- **Refine-loop / scoring / convergence** — the parked "tool" half; re-enable once
  the user has recognized a target taste worth refining toward.
- **Persistence** beyond the current session.

## 10. Decisions locked

- **Show thoughts:** yes, **collapsible.** ✓
- **Turn structure:** fixed alternation, default **8 turns.** ✓
- **Character authoring:** **in-app, throwaway** (no `*.md` files). ✓
- **Ownership:** the **app** owns the loop + Scene Log; the **engine is unchanged.** ✓

## 11. Success criteria

- [ ] A user can author a Scene (two cards + situation) in-app and hit run.
- [ ] The app alternates the two characters for `N` turns, streaming each public
      line and a collapsible private thought, accumulating the Scene Log.
- [ ] Each character's secret and goal stay private to it; only its public line
      enters the shared log.
- [ ] Re-running after editing one secret produces a materially different scene.
- [ ] At least one authored scene reliably yields an unscripted dramatic-irony beat
      — the first fun moment.
- [ ] No change was required to the chain engine.
