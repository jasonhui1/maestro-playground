/**
 * What this engine can do, for a client that ships separately from it (the Obsidian
 * chain runner, say). A client feature-detects here rather than pinning an engine
 * version, so an old engine fails loudly instead of a client drawing a stale rule (#76).
 *
 * A flag is added when the behaviour ships and never removed while any client reads it.
 */
export const CAPABILITIES = {
  /** `/api/run` streams `{ type: 'layout', model }` frames, and every panel carries `node`. */
  runLayoutFrames: true,
  /** `/api/run` emits `{ type: 'run_start', runId }` as the first event of the stream. */
  runStartEvent: true,
  /** A failed run streams a final `layout` frame — pending panels `errored`, each
   *  carrying the message — before its `error` event. */
  runFailureFrame: true,
  /** `POST /api/runs/:id/fork` takes `{ from?, revisions?, versions? }` and streams the new run;
   *  `/api/run` no longer takes `branchOutputs` (#103). */
  runFork: true,
  /** A resume with `fork: true` leaves its source hold open and starts a separate run (#76). */
  resumeFork: true,
  /** Grouped launches and summaries are exposed by `/api/variance` (#133). */
  varianceGroups: true,
  /** `PATCH /api/runs/:id/holds/:holdId` takes `{ feedback }` and saves it on the open hold; `""` clears it (#134). */
  holdFeedback: true,
  /** `POST /api/runs/:id/holds/:holdId/reroll` streams fresh candidates, ending `run_waiting` (`reroll_failed`
   *  first when the old set stays); hold records and resume bodies carry `revision`, a stale one is 409 (#134). */
  holdReroll: true,
  /** The reroll route takes `fork` and `like` (a candidate heading), and forks an answered hold even while its run
   *  is running: the new run waits on the fresh set, its hold carrying `like`; a failed one never lands on disk (#147). */
  holdRerollFork: true,
} as const

export type Capabilities = typeof CAPABILITIES
