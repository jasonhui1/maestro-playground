# Streamed tool turns — what the wire actually did (#34)

**Status:** evidence record. The contract amendment in §2 was **confirmed
2026-07-26** and is folded into `2026-07-11-tools-design-map.md` as the
streaming caveat under "Context assembly = object-level wire-truth".

Produced by `scripts/derisk/streamed-tool-echo.ts`, run live against both
configured providers on 2026-07-26. Raw artifacts land in
`scripts/derisk/out/<provider>/` (gitignored); the chunk sequences the tests
replay are committed at `tests/fixtures/streamed-tool-turn.<provider>.json`.

| | `gemma-4-31b-it` (Google shim) | `deepseek/deepseek-v4-flash` (OpenRouter) |
|---|---|---|
| chunks in one tool-calling turn | 5 | 21 |
| reasoning shape | inline `<thought>` inside `content` | structured `reasoning` + `reasoning_details` |
| signed field present | `tool_calls[].extra_content.google.thought_signature` | none |
| signed field chunked? | **no** — arrives whole, on the chunk that opens the call | n/a |
| present non-streamed but missing from the stream | none | `refusal` (always `null`) |
| `usage` on a turn ending in `tool_calls` | **yes** — 96/19 | **yes** — 330/72 |
| echo of the rebuilt message | accepted | accepted |
| parallel calls in one turn | 2, merged by `index` | 2, merged by `index` |

## 1. The question the ticket was written around

*Is anything signature-verified chunked, or dropped by the stream?* On the two
providers reachable from this repo's `.env.local`: **no**. gemma's
`thought_signature` is the only sealed field either provider emits, it arrives
whole, and the rebuilt message echoes back without a 400.

**What that does not prove.** deepseek's `reasoning_details` entries are
`format: "unknown"` plain text with no `signature` — structured, but unsealed.
So neither track exercises a *sealed reasoning block* (Anthropic's signed
`reasoning.text`, or an `encrypted` item). Pointing `OPENROUTER_MODEL` at an
Anthropic model for one run would close that gap; until then the assembler's
handling of a sealed block is covered only by unit tests with synthetic chunks,
not by traffic. This is the same by-construction caveat #18 ended with.

## 2. The finding that changes the stated contract

The ticket's rule was: concatenate exactly two strings — assistant `content` and
each tool call's `function.arguments` — and copy every other field verbatim from
first sighting.

**That rule loses data on OpenRouter.** `reasoning` and `reasoning_details` both
arrive as fragments, one per chunk:

```
chunk 0  reasoning: "The"       reasoning_details: [{type:"reasoning.text", text:"The",      format:"unknown", index:0}]
chunk 1  reasoning: " user is"  reasoning_details: [{type:"reasoning.text", text:" user is", format:"unknown", index:0}]
…
```

First-sighting-wins would rebuild `reasoning: "The"` and echo a **truncated**
field — worse than omitting it, because on a provider that seals its reasoning a
truncated block fails verification one turn later, at the echo, where nothing
points back here.

**Proposed narrowing, as implemented in `lib/tools/streamAssembly.ts`:**
concatenate the payload strings a provider is *observed* to split, and copy
everything else verbatim from first sighting. The split set is closed and
enumerated in code:

- assistant `content`
- each tool call's `function.arguments`
- `reasoning`
- each `reasoning_details` entry's `text`, merged by the entry's own `index`

Identity and seal fields beside them — `type`, `format`, `id`, `signature`, and
an encrypted entry's `data` — are still first-sighting verbatim. `data` is
deliberately outside the set: joining a seal nobody has watched arrive would
hide the exact failure this ticket exists to catch, so a chunked one reports as
loss instead. None of the concatenated strings is itself signature-verified, so
the property the original rule was protecting is intact.

## 3. Lossiness is reported, not silent

`assembleStreamedResponse` returns `lossyFields`: any path outside the split set
that arrived twice with *different* values. First sighting is kept and the path
is named. Both live runs returned an empty list; the de-risk script promotes a
non-empty one to a printed finding, and `createChatCall` warns on one during a
real run. A chunked `signature` therefore surfaces where it happened, rather
than as a mystery 400 on the next turn.

## 4. Smaller observations

- **gemma restates `usage` on every chunk**, with `completion_tokens` growing;
  the assembler keeps the last value seen. Reading the first would report a
  0-token turn.
- **gemma's finish_reason on a tool-calling turn is `stop`**, not `tool_calls`.
  The loop keys off `tool_calls` being present, so this is inert — but any
  future logic that trusts `finish_reason` to mean "the model wants a tool" is
  wrong on this provider.
- **deepseek streams `content: ""` alongside its reasoning**, so a tool-only
  turn rebuilds with `content: ""` where the non-streamed response has `null`.
  The echo was accepted either way.
- **`refusal: null`** exists non-streamed and never appears in the stream.
  Dropping a field that is always null costs nothing.
