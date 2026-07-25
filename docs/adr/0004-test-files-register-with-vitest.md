# ADR-0004: Test files register with vitest, so "no tests ran" reads as failure

Date: 2026-07-24 · Status: accepted

## Context

#25 was filed on the premise that `npm run test:run` exits 0 when a test fails. That premise did not reproduce. Probing all three test-file shapes in `tests/` against vitest 4.1.9 — top-level synchronous asserts (~44 files), `async function main()` with a `.catch(process.exit(1))` tail (~9 files), and `runTests()` wrapped in `try/catch` (3 files) — a deliberately failing assertion exited **1** in every case. The ticket's `VITEST_EXIT=0` was almost certainly a measurement artifact: in zsh, `$?` after `cmd | tail` reports `tail`'s status, not `cmd`'s.

The real defect is one layer down, and the old config named it: `passWithNoTests: true` with zero registered tests meant the suite reported `Tests  no tests` and could not distinguish *a file that asserted* from *a file that did nothing*. Neutering `tests/log-tool-loop.test.ts` so its `main()` was never invoked produced `Test Files 56 passed (56)` and exit 0 — a test that silently stopped running was invisible. That is the same trust problem #25 is about, so the ticket stands; only its mechanism changed.

A secondary weakness: failures in the deferred-entry shapes surfaced as `Errors 1 error` while the file itself was still counted under `56 passed`, so the summary line contradicted the exit code.

## Decision

Every file in `tests/` registers its assertions with vitest via `test()`, and `passWithNoTests` is set to `false`.

- The 44 top-level files have their post-import body wrapped in a single `test('<file-stem>', () => { ... })`.
- The 12 deferred-entry files keep their existing `main()` / `runTests()` function and replace the hand-rolled invocation tail with `test('<file-stem>', main)`. Their `try/catch` blocks, which reported only `err.message` before calling `process.exit(1)`, are removed so vitest receives the whole error and its stack. `workspace-integration.test.js` keeps its `finally { cleanup() }`.
- `run-store.test.ts`'s two top-level-await IIFEs become two named `test()` calls, which also removes the top-level await.
- The per-file `console.log('✅ … tests passed')` lines are deleted. vitest now reports which tests passed, and keeping a hand-printed claim alongside it re-creates the unenforced success string this ADR rejects the alternative route for relying on.

A trap worth naming, because review caught it after the first pass: `tests/report-executor.test.ts` and `tests/run-stream.test.ts` use `run()` rather than `main()`, so the shape classifier filed them with the top-level files and wrapped their `run().catch(…)` tail *inside* a synchronous `test()` callback. The callback returned before the promise settled, so a failing assertion in either file was swallowed — `1 passed`, exit 0 — which is the exact defect this ADR exists to remove. Both now `await run()`. **Any promise a test body starts must be awaited by the registered callback; a floating promise re-opens the hole.**

## Rationale

- A registered test makes "did not run" observable in two independent ways: the `Tests N passed` count drops, and a file registering nothing fails outright with `No test suite found in file …`. Neither signal existed before.
- Attribution improves as a side effect: a failure now reports `Test Files 1 failed | 55 passed` / `Tests 1 failed | 56 passed` and names the file, instead of counting the failing file as passed and mentioning it only in an `Errors` block.
- The rejected alternative — replacing the runner with a script that spawns each test file under `tsx` and aggregates exit codes — was cheaper in diff (one new file, no test-file edits) and preserved the `npx tsx tests/<file>.test.ts` habit. It was rejected because it detects a no-op file only by scraping each file's `console.log('✅ …')` success line, which makes the suite's honesty depend on a printed string that nothing enforces; and because it required rewriting `run-store.test.ts` off top-level await anyway, since that file cannot transform under `tsx` (`Top-level await is currently not supported with the cjs output format`). It would also have lost vitest's watch mode and reporter.

## Consequences

- **`npx tsx tests/<file>.test.ts` no longer works.** Test files now import from `vitest`, which throws outside the vitest runner. Single-file runs are `npx vitest run tests/<file>.test.ts`, or `npm run test:file tests/<file>.test.ts` via the alias added afterwards to keep the per-file habit short. This is the concrete cost of this route over the rejected one. Updated accordingly: `README.md`, `docs/maestro/plans/2026-07-12-tools-slice0-slice1-impl-plan.md`, `docs/adding-a-node-kind.md`, and `package.json` (whose `test:unit: tsx` script was left over from that workflow, referenced nowhere, and is now removed). `docs/maestro/plans/2026-07-01-join-and-parallelism-impl-plan.md` still shows `npx tsx` throughout and is deliberately left alone: it is a dated record of work already completed, and editing it would falsify the record rather than fix a live instruction.
- The diff touches all 56 test files. It was produced by codemod, not by hand. Because 24 of those files embed multi-line markdown and YAML fixtures in template literals — where leading whitespace is load-bearing — the codemod tracked template-literal state and left those lines unindented. This was verified by extracting every template literal's raw text from `HEAD` and from the working tree and comparing byte-for-byte across all 56 files.
- Adding a new test file now requires calling `test()`. A file that forgets fails loudly rather than passing silently, which is the intended behaviour.
- There is no CI workflow and no pre-push hook in this repo, so "whatever runs in CI uses the honest command" is satisfied vacuously today. Any future CI should call `npm run test:run`.
- The pre-existing `@typescript-eslint/no-require-imports` errors in the `.js` test files are unchanged (25 lint problems before and after); they were not in scope here.
