# Architecture review — run lifecycle and result view (2026-09-18)

Output of `/improve-codebase-architecture` over the git hot spot since #93 (hold → resume → promote → fork → chat) and the result view. Vocabulary: `/codebase-design` (module, interface, depth, seam, adapter, leverage, locality). Each candidate is one GitHub issue; this file is the shared record the issues cite.

Legend: **Strong** = deletion test passes clearly (complexity concentrates); **Worth exploring** = friction is real, shape needs a grilling pass; **Speculative** = seam is hypothetical until a second adapter exists.

## 1. One `continueRun` behind resume, promote and fork — Strong

**Friction.** Resume, promote, fork and the run route each build the `RunSession` record by hand (ten fields; three sites also compute `resumeFrom`). The rule that makes replay work — the first `logged` entries of `replay` must be the *same objects* already on disk — is enforced by `Set` identity inside `streamChainRun` and `afterHistory`, and stated nowhere in the interface. Promote satisfies it only because `withoutNodes` filters rather than maps.

**Deepening.** One module owns "continue this run with this plan": load-continuation, step arithmetic, replay/history/holds assembly, in-place vs fork. Routes parse the request and hand over a plan named in CONTEXT.md vocabulary: `{answer: hold}` | `{promote: revision}` | `{branch}`.

**Interface shrinks.** `RunSession`'s ten fields and `resumeFrom` leave every route; `loadContinuation`, `contextOverrides`, `newRunId`, `refusalResponse` stop being four separately exported names.

**Tests.** `run-resume-route`, `run-promote-route`, `run-fork-route` currently boot a real workspace through `POST /api/run` to reach this arithmetic; they could assert step numbering and replay identity against one function. No test imports `lib/runSession`, `lib/promote` or `lib/fork` today.

**ADR.** ADR-0011 — "resumed steps keep the log and version they were written with" is what `resumeFrom` encodes. Concentrates the rule; does not change it.

## 2. The hold module owns the hold list — Strong

**Friction.** Four readers, four rules over `meta.holds[]`: `openHoldOf` (last without `resolvedAt`), `mergeHolds` (first open matching `nodeId`), the resume route's `targetHold` (named → open-if-waiting → several ⇒ 400 → finished ⇒ last), `promote.ts` ("answered hold downstream ⇒ fork"). The resume route patches the array by object identity. `pickOf` signals refusal with a bare string. The executor's hold arm inspects `candidates.length` and names the literal `'Candidate 1'` — a decider convention, not scheduling.

**Deepening.** `hold.ts` owns `HoldRecord[]`: select, answer, un-answer for a fork, merge, the no-candidates warning, and "is this answer a resume or a fork". The executor calls it.

**Interface shrinks.** Four exports collapse toward `selectHold(meta, holdId)` / `applyAnswer(holds, hold, direction, pick)`; `pickOf` and `targetHold` leave the route.

**Tests.** No unit test covers selection; the multi-hold 400/404 cases live in `run-fork-route` and need a two-hold chain on disk. The "no candidates warns" case in `executor-hold` needs a whole chain to assert one string.

**ADR.** ADR-0001 — nothing moves into the registry; the executor keeps its dispatch arm. Not a conflict.

## 3. One replay-set builder; branch becomes a fork — Strong

**Friction.** "Which record is current" is answered by three private keys: `runHistoryState` (`nodeId`), `fork.ts` (`nodeId|round`), `nodeChat.ts` (`nodeId|round|timestamp`), plus `stepIndexOf`. The replay set is built twice (fork: descendants → withoutNodes → collapse; promote: descendants → withoutNodes). `forkRun` grew a `below?` escape hatch because promote had already computed descendants. The older branch path takes `branchOutputs` from the client and writes a `RunMeta` with no `holds`.

**Latent bug.** Branch a run past an answered hold: the new run's `meta.holds` is `undefined`, the executor does not re-open the replayed hold, `streamChainRun` writes `complete`, and resume answers 409. The existing test asserts the hold's log file, never `meta.holds`.

**Deepening.** Promote `partialRun.ts` from graph-set arithmetic to record arithmetic: one record key, latest-wins collapse, descendants, replay set for a rerun anchored at a node, holds below an anchor. Fork and promote call it. `POST /api/run` drops `branchOutputs` / `branchedFromRunId` / `branchedFromStep`; `branchRun.ts` is deleted; branch is a fork.

**ADR.** ADR-0011 leaves open which versions a branch replay uses (branch re-pins; fork/resume re-pin via `loadContinuation` and keep `meta.versions`). Unifying is the moment to decide — must not land silently. ADR-0016 rule 4 — the sidebar's per-round path in `layoutModel` stays distinct from the collapse.

## 4. A run-scoped route loads its run once, refuses one way — Worth exploring

**Friction.** Four encodings of "no": `Refusal {error,status}`, `ChatRefusal` string union + status map, `PromoteRefusal` widening that map, and sixteen bare `NextResponse.json({error},{status})`. Discriminated three ways (`'error' in x`, `'refused' in x`, bare string). The `readRunMeta` try/catch is copied at six routes; the `status === 'running'` guard at three, with three messages.

**Deepening.** One `Refusal` value produced at its source; one `loadRunFor(runId, {mustNotBeRunning})` every run-scoped route calls first.

## 5. `runChainGraph` takes a request, not thirteen positions — Worth exploring

**Friction.** Thirteen positional parameters, six defaulted; `startOutputs` means branch, resume or promote replay depending on caller; test call sites pad four empty arrays to reach position eleven.

**Deepening.** Positions 7–13 become one named request record (`seedPrompt`, `paramValue`, `context`, `replay`, `run`, `depth`). Wavefront core untouched. Pairs with #2 so the hold arm calls the hold module.

**ADR.** ADR-0002 — `runFn` stays `(agent, prompt, message, opts) ⇒ AgentOutput`; the record must not widen it. ADR-0001 — dispatch stays in the executor. Wide refactor across ~40 test call sites: expand–contract.

## 6. One result-view fold shared by the live page and history — Worth exploring

**Friction.** The live page re-flattens `RunStateMap` into outputs to build a fallback layout model, coalesces it with the streamed model by `??`, and resets nine pieces of state in an order nothing enforces. History builds the same model twice (once for the initial view mode, once for render) and the two can drift. Both pages copy the `usePanelDeck` + `usePanelFit` + `buildRunFrame` wiring. No render tests exist; none of this composition is testable.

**Deepening.** One fold module behind a seam with two real adapters: the run stream and a `RunMeta` from disk. Returns `{model, frame, deck, fit}`.

**ADR.** ADR-0017 keeps the local build as a fallback; this gives it one seam, does not remove it.

## 7. A seam for the run store — Speculative

**Friction.** Filesystem and run store (meta.json + step logs) are reached by direct import — zero adapters; sixteen test files call `mkdtempSync`; five route tests share a ~30-line temp-workspace preamble. Read-modify-write of meta.json is not atomic; the "no await since the status read" comments are the only guard against concurrent resumes.

**Deepening.** Accept a store, don't create it: `read(runId)`, `update(runId, patch)`, `appendStep(runId, output)` with disk and in-memory adapters. vision.md's filesystem-first stays the contract; the seam is about who calls `fs`.

## Wave two — chain file, editor, model call, workspace fs

Colder in git than the run lifecycle; kept where the deletion test passes or a latent bug sits behind the shallowness.

### 8. `serializeChain` takes a `ChainDef`, not a hand-built `ChainMeta` — Strong

`parseChainContent` reads nine frontmatter keys; `chainMeta` hands six back. `purpose` and `parameter` are dropped on every editor save (docs/maestro/chains.md already records that dragging a node in `domain-transplant.md` deletes its `parameter:` and validation then rejects its own `param` node). The round-trip test hand-builds two keys so it cannot see this. Deepening: delete `ChainMeta`/`chainMeta()`; the serializer reads the chain; test `parse(serialize(parse(raw))) ≡ parse(raw)` over a fixture with every key. ADR-0015/0016.

### 9. One module owns the `{token}` grammar — Strong

Six scanners: `refs.ts` and `resolver.ts` split on the last dot; `condition.ts` and `parseChain.parseEndpoint` on the first; `chainGraph.refRe` is a regex lookalike of the condition tokenizer; `slots.ts` states the negation. `refs.ts` opens with "Mirrors lib/resolver.ts semantics". `resolver.ts` reads fs itself and is reachable only from the chat route. Deepening: one pure grammar module (`Slot | AgentRef | FileRef | Endpoint`, one dot rule, one slugify-vs-exact rule); `refs.ts` and `resolver.ts` vanish. Worth an ADR.

### 10. Delete the dead second React Flow implementation — Strong

`components/workspace/ChainFlowBuilder.tsx` (351 lines, zero importers, own dagre + frontmatter, `useNodesState` — the #64 loop shape) and `components/workspace/AgentNode.tsx`. `tests/flow-sync.test.js` imports nothing from lib and asserts gray-matter round-trips an `agents:` key `ChainDef` does not have (ADR-0004). Subtraction only.

### 11. `runAgent` has one body — Strong

`runAgentWithTools` (chatCall seam, partial cost on error) vs the plain body (real client only, `costUsd: 0` on error). Both chat routes take the plain branch, so six route tests `vi.mock('@/lib/runner')` wholesale. Deepening: the no-tools case runs the same loop with an empty tool set; one cost rule; one seam; `runner-tools.test.ts`'s fake covers the chat routes. Grill: should chat routes bind the agent's tools? Neither does today. ADR-0002 made literally true.

### 12. Sockets and handles get one seam on the canvas — Worth exploring

`buildData` flattens `InputSocket[]` to `string[]` (throws away `optional`); `SeedNode`, `ReportNode`, `BranchNode`, `LoopStartNode` hardcode handle ids the registry already holds; nothing checks the two agree. Deepening: one socket-rendering module reading `kindOf(kind).inputs/outputs`; `EditorNodeData.inputs/outputs` go; new test "every socket has a handle and every handle a socket". ADR-0001: one reader of facts, no behaviour on descriptors.

### 13. One validation over one chain — Worth exploring

`validateChain` runs over the disk copy (`app/workspace/page.tsx` → ValidationPanel) and over the live reducer state (`ChainEditor` → red borders); they disagree until autosave + refetch. `ChainCanvas` refuses self-edges and unnamed handles that the validator accepts. `chainGraph.refRe` disagrees with `condition.ts` about a valid ref. Deepening: the editor owns the live chain and publishes validation upward; `validateChain` absorbs the canvas rules and calls condition's parser. Blocked by 9.

### 14. Merge `editorReducer` into `editorOps` — Worth exploring

Nine of twelve reducer arms are one-line spreads; its only own knowledge (`multiInput`) exists because `connectEdge` takes a boolean instead of the node. `join-connect` tests the rule twice. Deepening: ops take nodes/edges, `connectEdge` reads the kind; `EditorAction`, `EditorState`, `allowMulti` deleted; three test files become one.

### 15. The workspace root is accepted, not read from the process — Worth exploring

`getWorkspacePath()` reads `process.env.WORKSPACE_PATH` per call at 15 sites in 9 files; the explicit `workspacePath` params are always that global one level up. Seven tests mutate the env + mkdtemp, including `log-tool-loop` which tests markdown formatting. Sibling of #108 (run store).

### 16. Workspace fs errors carry a class, not a phrase — Worth exploring

`app/api/workspace/errors.ts` maps six message substrings to statuses; throw sites carry comments warning not to reword. Deepening: a discriminated `WorkspaceError` constructed at the throw site; the encoder is an exhaustive switch.

### 17. One variant index — Worth exploring

`findAgentFile` (full `parseAgent` per lookup, throws on any malformed agent file) vs `entityRefs.variantIndex` (raw frontmatter, Map once, tolerant). Deepening: workspace resolution uses the index rename/delete already trust. ADR-0012/0013.

### 18. `retrieve` reuses `listSections` — Strong (small)

`retrieveExecutor.splitSections` is byte-for-byte `graph.listSections`; its comment claims a slugify difference that does not exist.

## Wave three — the workspace IDE shell

### 19. A workspace store owns the file list and its invalidation — Strong

`Sidebar.tsx` holds 25 `useState`s and refetches `/api/workspace` from six handlers; `app/workspace/page.tsx` fetches the same endpoint into five more arrays, only for chains; six write handlers repeat fetch + ok + toast and each decide 409-inline vs toast alone; `HistoryPane` calls `window.location.reload()` after a restore. Deepening: one store (shape of `useRunStore`) with the list, root, empty folders and seven mutations that refetch and classify failure internally. Tests in the shape of `run-store.test.ts`. ADR-0012/0014.

### 20. Editing a file is one module — Strong

`useAutoSave` returns `flush`/`isDirty` (zero callers) and `getLastSaved` (one caller, `ChainEditor`, which runs the reconcile the hook declined to run). Watch + reconcile are wired for the graph editor only; the YAML/agent path has neither, so an external edit to an open agent file silently loses one side. The page carries `graphSaveStatus`/`onSaveStatus` as a second status channel. Deepening: `useEditedFile(type, slug) → { content, setContent, status, conflict, resolve }`; `useFileWatch` and `reconcileExternalEdit` private.

### 21. One statement of what a valid entity file is — Worth exploring

`FileEditor.tsx:60-75` is the only place saying an agent needs `name`+`model`, a template `chain`, a tool `executor`; the server accepts a file with none. Frontmatter parsed three times per keystroke with three failure behaviours. The editor's list ignores the defaults file (ADR-0010), so an agent inheriting `model` is flagged invalid. Deepening: `validateEntityFrontmatter(type, data, defaults)` in `lib/fs/validate`; route returns issues; editor renders markers.

### 22. One variant-aware address resolution — Strong (bug)

The entity route applies ADR-0013 by hand at GET/PUT/PATCH; the versions route and the watch route never do. A variant's versions tab reads `.versions/agent/<variant>/` (cannot exist → always "No snapshots yet"); watching a variant watches a nonexistent file. Deepening: `resolveAddressedFile(type, slug) → { filePath, storageSlug }`; every route calls it once. Overlaps #118.

### 23. Tab arithmetic lives in `lib/fs/tabs` — Worth exploring

`parseTabs`/`serializeTabs` are tested and used by `TabController`; `Sidebar` hand-writes the URL string three times with a 15-tab cap found nowhere else and a successor-on-close rule that contradicts `TabController`'s. Deepening: `openTab`/`closeTab`/`renameTab` in the module.

### 24. Chat page uses `streamRun` — Strong (bug, small)

`app/chat/page.tsx` hand-rolls the SSE reader and splits on `\n` where the protocol frames on `\n\n`; a token containing a newline is swallowed. `useRunStore` inlines `runErrorMessage`.

### Wave three — left alone

`lib/fileTree.ts`, `useRunStore`, `useLaunchMemory`, `syncReconcile`, `tabClamp`, `entityDirs`, `components/ui/*`. Correctly shallow: `useToastStore`, `resultControls`/`resultType`. Fold candidates too small for a ticket: `useSelectionStore` is one field on the per-file run record; `lib/pricing.ts` silently prices an unknown model at 0 (bug, see findings). Dead: `components/workspace/AgentNode.tsx` (one importer, #111's file) — added to #111.

### Behaviour findings, not ticketed

- `lib/pricing.ts` prices an unknown model at 0, and that flows into meta.json and the run frame's cost.
- The entity route's PUT/POST bypass `workspaceErrorResponse` and return bare 500s.
- `parseAgent`: an env model silently overrides every agent file's `model:` at parse time (ADR-0003 territory).
- Neither chat route binds the agent's tools.
- The export route renders its own markdown from meta.json, dropping tool loop, warnings, conversation.
- `InterfacePanel` cannot edit a port's `socket` or `role: join`.

## Left alone (already deep)

`executor.ts` wavefront core (ADR-0001), `layoutModel.ts` + `latestOutputsByNode` (ADR-0017), `compareModel.ts`, `runVersions.ts` (ADR-0011), `runStream.ts` framing, `nodeChat.chatTranscript`, `runFrame.ts`, `tools/loop.ts` + `streamAssembly.ts`, `provider.ts`, `graph.ts`, `resolveNode.ts`, `canvasView.ts`, `sectionWarning.ts`, `fileTree.ts`, `fs/rename.ts`, `fs/delete.ts`, `logger.ts` write side. `sse.ts` and `panelDeck.ts` are shallow by design — deleting them only moves complexity.
