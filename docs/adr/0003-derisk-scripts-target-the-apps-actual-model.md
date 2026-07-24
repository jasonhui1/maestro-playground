# ADR-0003: De-risk scripts target the app's actual wired model, not an assumed list

Date: 2026-07-19 · Status: accepted

## Context

#19 (convention-compliance spot-check, gating the tools slice's warning-loudness call) asked for "2-3 intended default models ~5 times each." No such list exists as a single source of truth in this repo: `.env.example` documents the app's default provider as gemma via Google's OpenAI-compat endpoint (`AI_API_KEY`/`AI_BASE_URL`/`AI_MODEL_NAME`), while every shipped `workspace/agents/*.md` file's `model:` frontmatter names `anthropic/claude-3.5-sonnet` (routed through the OpenRouter-shaped base URL `runAgent` uses by default). Picking 2-3 models to test would mean inventing a list the codebase doesn't actually assert, and no OpenRouter API key was available in the working environment to exercise that second path anyway.

## Decision

De-risk scripts that need "a model" (starting with `scripts/derisk/convention-check.ts`, #19) target the app's actual current runtime configuration — whatever `AI_API_KEY`/`AI_BASE_URL`/`AI_MODEL_NAME` resolve to in `.env.local` — as the single default test subject, rather than guessing at a fixed multi-model list. Where a script benefits from testing a second provider, it exposes a `DERISK_PROVIDER=openrouter` override (mirroring the pattern already established in `scripts/derisk/reasoning-roundtrip.ts`, #18) so a second/third model is a rerun with an env var, not a rewrite.

## Rationale

- Testing against real wiring answers the question that matters ("does what actually runs today skip the convention?"); testing against an invented list answers a question about a config that may never be exercised.
- The disagreement between `.env.example` and `workspace/agents/*.md` is itself a live discrepancy, not something a de-risk script should paper over by picking a side.
- `reasoning-roundtrip.ts` already solved "make a de-risk script provider-adaptive" for #18; reusing that shape keeps multi-model coverage cheap to add later instead of speculatively building it now for a need that isn't confirmed.

## Consequences

- Single-run de-risk scripts under-cover the "especially cheaper OpenRouter ones" risk the design map calls out (2026-07-11, tools-design-map.md) until someone actually runs with `DERISK_PROVIDER=openrouter` and an `OPENROUTER_API_KEY`.
- A compliance finding from one of these scripts (e.g. #19's 5/5 on `gemma-4-31b-it`) is evidence about that model only — it does not generalize to whatever model a given workspace's agents actually name, and should be captioned as such wherever it's cited (see the #16/#19 issue comments).
- If a workspace ever standardizes its agents' `model:` frontmatter to match `.env.example`'s stated default (or vice versa), this ADR's premise (the two disagree) goes away and future de-risk scripts can target that single agreed default directly.
