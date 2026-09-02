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
} as const

export type Capabilities = typeof CAPABILITIES
