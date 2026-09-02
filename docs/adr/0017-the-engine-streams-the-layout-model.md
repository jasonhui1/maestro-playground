# ADR-0017: The engine streams the layout model

Date: 2026-09-02 · Status: accepted

## Context

ADR-0015 made the panel list a projection: `buildLayoutModel(chain, outputs)`.
Until now the only way to read that projection from outside this repo was
`GET /api/runs/:id/layout`, which calls `readRunMeta` — so it answers only for a
run already written to disk.

Every live view needs the panels earlier than that. `app/result/page.tsx` needed
them while the run streams, and solved it by importing the builder and calling it
on the outputs it collects from the stream. The Obsidian chain runner
(jasonhui1/obsidian-chain-runner #4) needs the same thing across a repo boundary,
and solved it the only way it could: by porting `lib/layoutModel.ts` into the
plugin.

A ported rule diverges silently. Change what separates `empty` from `errored` here
and the plugin keeps drawing the old rule, with no error and no failing test in
either repo.

There is a second, smaller problem. `buildLayoutModel` reads outputs as a **list**,
and `view: sidebar` turns a loop body's rounds into one panel each (ADR-0016
rule 4). A client that accumulates outputs keyed by node — which is what a
streaming client naturally does — can only ever hold the last write, so live
sidebar rounds collapse until the run lands and the finished run is re-read.

## Decision

`POST /api/run` emits the layout model on the run stream:

```
data: {"type":"layout","model":{"kind":"timeline","panels":[...]}}
```

One frame before the executor starts — so panels exist before hop 1 — and one
after every `agent_done`. The engine holds the outputs as a list, which is what
the builder wants, so a streamed sidebar keeps its rounds.

Every `LayoutPanel` carries `node`, the inner node its port binds to. A live view
overlays tokens onto the panel currently writing, and token events are keyed by
`nodeId`; without this the only join is the display name.

Frames carry the full text of every panel, re-sent per hop. A changed-panels-only
frame would need a merge rule on each client — a second serialisation rule to keep
in step, which is the failure this ADR exists to remove.

`GET /api/workspace` reports `capabilities` (`lib/capabilities.ts`). A separately
shipped client feature-detects there rather than pinning an engine version, so an
old engine fails loudly instead of a client silently drawing a stale rule.

## Consequences

The projection has one implementation and one owner. A client renders panels
without a copy of the rule, and a chain edited here changes every client's panels
at once.

`app/result/page.tsx` prefers the streamed model and keeps its local build as the
fallback for a run that never streamed one. Deleting that fallback would be a
second change; the reason to keep it is that history and branch replay build the
same model from disk.

The stream is now a contract with clients outside this repo, so a change to the
panel shape is a breaking change for them. `capabilities` is where that is
declared; a flag is added when the behaviour ships and not removed while a client
reads it.

Cost is a full re-serialisation of the panel text per hop — a ten-hop chain sends
its result ten times. This is localhost, and the trade buys one rule instead of
two.

`GET /api/runs/:id/layout` is unchanged: it is still how a finished run is read.
