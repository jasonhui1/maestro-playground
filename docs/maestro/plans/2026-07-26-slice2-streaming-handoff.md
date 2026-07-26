# Handoff: what #34 left for #35 (and #36)

#35 is the direct continuation. #34 built the streaming adapter; #35's
`tool_pending` event has nowhere else to come from — its own text says so: *"The
pending event can only come from the streaming adapter, because 'the model has
begun emitting a tool call' is a stream fact."* That adapter now exists, and
this is what it looks like from the inside.

## 1. The seam, and the one line that has to change

`createChatCall` in `lib/runner.ts` drains the whole stream into an array, then
assembles:

```ts
const received: StreamChunk[] = []
for await (const chunk of stream) received.push(chunk as unknown as StreamChunk)
return received
```

`tool_pending` fires inside that loop, on the first chunk whose delta carries
`tool_calls`. One branch, one boolean. Nothing needs restructuring — assembly
stays after the drain, because a settled turn is what the loop is owed.

**Do not move assembly into the loop body.** `assembleStreamedResponse` is pure
and replay-tested (`tests/tool-stream-replay.test.ts` runs it against two real
captured sequences); folding an event sink into it would trade that for nothing.
Emit from the drain, keep the assembler dumb.

## 2. The problem #35 has to solve first: the adapter does not know the turn

`tool_pending {nodeId, step, turn}` needs a turn number. The adapter is built
once per agent (`createChatCall(agent)`) and has no idea which turn it is
serving. The loop knows — `toolTurns` in `lib/tools/loop.ts`.

Three ways out; pick deliberately, because this shapes the sink's whole
signature:

1. **Loop stamps the turn onto the request.** `ChatCallRequest` grows an
   optional `turn: number`; the loop already has the value at the call site.
   Smallest change, keeps the sink one-directional. My lean.
2. **Loop wraps the chatCall per turn** — a closure per iteration carrying the
   turn. No interface change, but the seam stops being one function.
3. **Adapter emits turn-less, reducer infers.** Cheapest now, and it
   re-creates the "second parallel notion of what belongs to a turn" that #35
   explicitly names as the failure mode to avoid. Don't.

Whichever wins, the call and result events still come from the loop through its
own injected sink, per #35's brief. Only `tool_pending` needs this.

## 3. The hidden cost in #35: token events on the tool path

`runAgent`'s `onToken` callback is **never called for a tool-using agent** —
not before #34, not after. #34 deliberately left it that way (events are #35's
scope), so "tool-using agents stream" is currently true on the wire and
invisible in the UI. #35's *"`token` events gain a turn number"* is therefore
not an amendment to existing behaviour on this path; it is the first time the
path emits tokens at all.

The awkward part: the tool-less path has an incremental `<thought>` parser
(`lib/runner.ts`, the buffer/partial-tag machinery around the tool-less
stream loop) that splits thought from output *as deltas arrive*. The tool path
uses `splitThought()` after the turn settles. To stream tokens per turn you need
one of:

- reuse the incremental parser in the drain loop (it is currently inline in
  `runAgent`, not extracted — extracting it is the real work), or
- emit raw token deltas and split per turn at the end, accepting that thought
  and output interleave wrongly mid-turn.

Budget for the extraction. It is the largest unestimated piece of #35.

## 4. Reuse, don't reimplement

- `groupToolCallsByTurn` — `lib/tools/logFormat.ts:19`, already pure and
  client-safe. #35's reducer must converge on this grouping, per its brief.
- `assembleStreamedResponse` — `lib/tools/streamAssembly.ts`. Returns
  `lossyFields` alongside the response; `createChatCall` warns when non-empty.
  If #37 wants lossy reconstruction as a visible chip, the signal already
  exists and needs no new plumbing.
- Replay fixtures — `tests/fixtures/streamed-tool-turn.{google,openrouter}.json`.
  Each holds `chunks` (a single tool-calling turn) and `parallelChunks` (two
  calls in one turn). Any streaming test can use these instead of mocking HTTP.

## 5. Provider facts the UI should not be surprised by

Measured on the two configured providers (2026-07-26):

- **gemma streams in ~5 chunks for a whole turn.** There is no smooth typewriter
  effect to render; a tool turn arrives in a few large gulps. A UI tuned on
  OpenRouter's 21-chunk cadence will look broken here, and vice versa.
- **gemma's `finish_reason` on a tool-calling turn is `stop`, not
  `tool_calls`.** The loop keys off `tool_calls` being present. Any new UI logic
  that reads `finish_reason` to mean "the model wants a tool" is wrong on the
  app's own wired model.
- **gemma restates `usage` on every chunk** with a growing `completion_tokens`;
  the last value is the real one.
- **deepseek emits `content: ""` alongside reasoning**, so a tool-only turn has
  an empty-string content where the non-streamed shape has `null`.

## 6. Known gap — RESOLVED 2026-07-26: folded into #35

**deepseek's reasoning never reaches the thought panel.** Nothing in the
workspace prompts for `<thought>`; gemma emits it natively inside `content`,
while deepseek puts thinking in `reasoning` / `reasoning_details`. The tool path
derives `thought` by running `splitThought()` over the text, finds no tag, and
returns empty — so the node reasoned and the panel is blank.

The reasoning itself is intact: reassembled whole and echoed to the provider on
the next turn (that is what #34 protected). Only display drops it.

The design map already called this shot — *"`<thought>` parsing becomes one of
two presentation sources (native reasoning fields when present, else tags)"* —
and the second source was never built. It is now #35's scope: small enough to
fold in (~12 lines across the adapter, the loop's result, and the tool-less
stream loop) and additive on the hooks seam #35 builds anyway. Both halves ship
together — streaming the deltas without also sourcing the settled `thought`
fills the panel during the run and blanks it at `agent_done`.

The same gap exists on the tool-less path, which reads only `delta.content`.

## 7. Open decision inherited from #34 — CONFIRMED 2026-07-26

The concatenation set was widened from the two strings #34's ticket named to
four. Confirmed on the fixture evidence: deepseek splits one turn's reasoning
across 13 `reasoning` deltas with zero content deltas, so first-sighting-wins
would echo 1/13 of it back to the provider. Folded into the design map as the
streaming caveat under "Context assembly = object-level wire-truth";
`2026-07-26-streamed-tool-turns-findings.md` §2 is no longer provisional.
