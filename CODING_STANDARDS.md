# Coding Standards

Read by `/code-review`'s Standards axis. Each rule cites the ADR that ratified
it — the ADR carries context and rejected alternatives; this file carries only
the appliable rule.

## Comments

- **A comment exists only where the code can't explain itself** — a non-obvious
  constraint or gotcha, 1–2 lines max ([ADR-0009](docs/adr/0009-comments-only-where-code-cannot-explain.md)).
  No rationale essays, no mechanism restatements, no "why this is correct"
  justifications. A mechanism's story lives in `prototype/src/compiler/staged/CONTEXT.md`
  or an ADR; the use site carries at most the bare anchor.
- **Comments cite only stable anchors** — a GitHub issue number, a
  failure-class code, a decision code, or an ADR
  ([ADR-0006](docs/adr/0006-code-comments-cite-stable-anchors.md)). Never a
  plan/spec path, task number, or finding label.
- **No unbacked attributions** — "user decision" appears only with an issue
  number as evidence (ADR-0006 rule 4).

## Module structure

- **No stage module imports a sibling stage** — shared behaviour hoists into a
  non-stage primitive ([ADR-0002](docs/adr/0002-no-sibling-stage-imports.md)).

## Decision vocabulary

- **Decision codes (`D-*`) are defined once**, in
  `prototype/src/compiler/staged/CONTEXT.md`
  ([ADR-0005](docs/adr/0005-decision-code-vocabulary-home.md)). Code comments
  and docs reference the code, never restate the mechanism.
- **Never mint a new decision code during implementation**  New codes come only from a ratified ADR: one code per
  mechanism, mnemonic letters (no numbered sequences like `D-1..D-8`), and
  only when a runtime `flags`/`notes` string needs decoding. Source comments
  cite the ADR/issue number instead of a code.

## Implementation
- prefer maintainable and scalable implementation solutions