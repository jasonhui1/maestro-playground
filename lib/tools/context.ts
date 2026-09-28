import type { FixedParts, ImageOverride, ToolCallRecord } from '../types'
import type { RunFolders } from '../runFolders'

/** Where a tool saves an image it made; returns the engine-relative URL it is served at. */
export interface ImageSink {
  save(name: string, bytes: Uint8Array): string
}

/** What an executor reaches beyond the model's params and its tool file's config. */
export interface ToolContext {
  workspacePath: string
  /** Absent where there is no run to save into. */
  images?: ImageSink
  imageOverride?: ImageOverride
  /** The calling node's wired or literal part values (#149). */
  fixedParts?: FixedParts
}

export function imageUrl(runId: string, name: string): string {
  return `/api/runs/${encodeURIComponent(runId)}/images/${name}`
}

/** Tools running on behalf of `runId`: images land in its folder, under its override (#148). */
export function runToolContext(ws: { root: string; runs: RunFolders }, runId: string): ToolContext {
  return {
    workspacePath: ws.root,
    images: {
      save(name, bytes) {
        ws.runs.writeImage(runId, name, bytes)
        return imageUrl(runId, name)
      },
    },
    imageOverride: ws.runs.read(runId).imageOverride,
  }
}

/** `output` with a trailing `## Images` listing every image its calls saved that it does not link already (#148). */
export function attachImages(output: string, toolCalls: ToolCallRecord[]): string {
  const missing = [...new Set(toolCalls.flatMap(c => c.images ?? []))].filter(url => !output.includes(url))
  if (missing.length === 0) return output
  const section = `## Images\n\n${missing.map(url => `![](${url})`).join('\n\n')}`
  return output.trim() === '' ? section : `${output.trimEnd()}\n\n${section}`
}
