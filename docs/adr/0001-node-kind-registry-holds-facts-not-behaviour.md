# ADR-0001: The node-kind registry holds facts, not behaviour

Date: 2026-07-16 · Status: accepted

## Context

Node-kind knowledge (fields, sockets, capabilities) was re-described in ~8 files; adding the `report` kind took six commits across six files. We are consolidating it into a registry, `lib/nodeKinds.ts` (issues #2–#9). The question was whether descriptors should also carry an `execute()` — turning the registry into a plugin system and the executor into a generic walker.

## Decision

Descriptors hold **facts only**: persisted fields (with codecs), input/output socket functions, palette data. Execution behaviour (gate condition evaluation, branch routing, zone iteration, subchain recursion) stays in `lib/executor.ts`'s per-kind dispatch.

## Rationale

- The facts were duplicated eight ways; the behaviour lives in exactly one place already. Moving it buys no locality.
- Kind behaviour is entangled with the executor's private state (`live` edge set, `markOut`, results, recursion depth). A descriptor `execute()` would need all of that as parameters — the executor's internals would become part of the registry's interface, widening it rather than deepening it.
- vision.md: this is not a framework and does not take third-party node kinds. A plugin architecture solves a problem Maestro refuses to have.

## Consequences

- Adding a kind = one descriptor + one executor dispatch arm + one canvas component (the latter compiler-enforced).
- Future architecture reviews should not re-propose a plugin-style executor unless third-party kinds become a real requirement.
