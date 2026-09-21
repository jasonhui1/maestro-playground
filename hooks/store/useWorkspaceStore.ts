// hooks/store/useWorkspaceStore.ts
// One owner of the workspace file list and of everything that invalidates it (#120).
import { create } from 'zustand'
import { AgentDef, SkillDef, ChainDef, TemplateDef, ToolDef, RenamePlan, WorkspaceTab, WorkspaceTabType } from '../../lib/types'
import { ENTITY_DIRS } from '../../lib/entityDirs'
import { workspaceRootOf, type EntityType } from '../../lib/fileTree'
import { closeTab, renameTab, tabKey } from '../../lib/fs/tabs'
import { useToastStore } from './useToastStore'

export interface ContextFileDef {
  slug: string
  name: string
  filePath: string
  rawContent?: string
}

/** The `/api/workspace` payload, as every reader of the list sees it. */
export interface WorkspaceFiles {
  agents: AgentDef[]
  skills: SkillDef[]
  chains: ChainDef[]
  templates: TemplateDef[]
  context: ContextFileDef[]
  tools: ToolDef[]
  defaults?: Record<string, unknown>
  models?: string[]
  envModelOverride?: boolean
}

// One frozen value, so a selector reading an untouched slice is referentially stable.
export const EMPTY_FILES: WorkspaceFiles = Object.freeze({
  agents: [], skills: [], chains: [], templates: [], context: [], tools: [], models: [],
}) as WorkspaceFiles

/** What the tabs looked like before a mutation, and what they look like after it. */
export interface TabState {
  tabs: WorkspaceTab[]
  active: string | null
}

export type Outcome<T = unknown> =
  | ({ ok: true } & T)
  /** The message to show in the open form, or null when the store has already toasted it. */
  | { ok: false; inline: string | null }

export interface EntityRef {
  type: EntityType
  slug: string
}

/** An entity plus the display name a toast needs to name it. */
export interface NamedEntityRef extends EntityRef {
  name: string
}

// Where a failed mutation's message lands — see **Surface** in CONTEXT.md. 400 joins 409
// because the rename preview already showed a malformed name inline (#54).
type Surface = 'form' | 'bare'
const FIXABLE = new Set([400, 409])

interface WorkspaceStore {
  files: WorkspaceFiles
  /** Absolute workspace root, recovered from the paths — the API never sends it. */
  root: string | undefined
  /** Per type, the folders discovery cannot see because they hold no markdown (#52). */
  emptyFolders: Partial<Record<EntityType, string[]>>
  loaded: boolean
  error: string | null

  /** `fresh` skips the shared request in flight, which a write's refetch must do. */
  load: (opts?: { fresh?: boolean }) => Promise<void>
  loadFolders: (type: EntityType) => Promise<void>

  create: (req: { type: EntityType; name: string; fromTemplate?: string; folder?: string }) =>
    Promise<Outcome<{ slug: string; seedPrompt?: string }>>
  createFolder: (req: { type: EntityType; name: string; parent?: string }) => Promise<Outcome>
  remove: (target: NamedEntityRef, tabs: TabState) => Promise<Outcome<{ tabs: TabState }>>
  move: (target: NamedEntityRef, folder: string) => Promise<Outcome>
  planRename: (target: EntityRef, to: string) => Promise<Outcome<{ plan: RenamePlan }>>
  rename: (target: EntityRef, to: string, tabs: TabState) => Promise<Outcome<{ tabs: TabState }>>
  renameFolder: (req: { type: EntityType; folder: string; name: string }) => Promise<Outcome>
  removeFolder: (req: { type: EntityType; folder: string }) => Promise<Outcome>
}

// Concurrent mounts of the sidebar, the editor and a launch form share the request in
// flight rather than each asking for their own copy. A reply older than one already
// applied is dropped, so a slow read cannot overwrite a write's fresher refetch.
let inflight: Promise<WorkspaceFiles | null> | null = null
let issued = 0
let applied = 0

const toast = (message: string, type: 'success' | 'error') =>
  useToastStore.getState().addToast(message, type)

async function messageOf(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json()
    return body?.error || fallback
  } catch {
    return fallback
  }
}

type SetState = (partial: Partial<WorkspaceStore>) => void

async function fetchFiles(set: SetState): Promise<WorkspaceFiles | null> {
  try {
    const res = await fetch('/api/workspace')
    if (!res.ok) throw new Error(await messageOf(res, 'Failed to fetch workspace'))
    return (await res.json()) as WorkspaceFiles
  } catch (err: unknown) {
    set({ error: err instanceof Error ? err.message : String(err), loaded: true })
    return null
  }
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => {
  /** Sends one write and routes its failure to this mutation's **surface**. */
  async function write(
    url: string,
    init: RequestInit,
    opts: { surface: Surface; fallback: string },
  ): Promise<{ body: Record<string, unknown> } | { inline: string | null }> {
    let res: Response
    try {
      res = await fetch(url, init)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      toast(message, 'error')
      return { inline: null }
    }

    if (!res.ok) {
      const message = await messageOf(res, opts.fallback)
      if (opts.surface === 'form' && FIXABLE.has(res.status)) return { inline: message }
      toast(message, 'error')
      return { inline: null }
    }

    try {
      return { body: await res.json() }
    } catch {
      return { body: {} }
    }
  }

  const refetch = async () => { await get().load({ fresh: true }) }

  return {
    files: EMPTY_FILES,
    root: undefined,
    emptyFolders: {},
    loaded: false,
    error: null,

    load: async (opts) => {
      const request = opts?.fresh || !inflight ? (inflight = fetchFiles(set)) : inflight
      const ticket = ++issued
      const files = await request
      if (inflight === request) inflight = null
      if (!files || ticket < applied) return
      applied = ticket
      const paths = Object.values(ENTITY_DIRS).flatMap(dir => (files[dir] ?? []).map(i => i.filePath))
      set({ files, root: workspaceRootOf(paths), loaded: true, error: null })
    },

    loadFolders: async (type) => {
      try {
        const res = await fetch(`/api/workspace/folders?type=${type}`)
        if (!res.ok) return
        const { folders } = await res.json()
        set(s => ({ emptyFolders: { ...s.emptyFolders, [type]: folders ?? [] } }))
      } catch {
        // best-effort: an empty folder just won't show up until the next successful fetch
      }
    },

    create: async ({ type, name, fromTemplate, folder }) => {
      const out = await write('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          name,
          ...(type === 'chain' && fromTemplate ? { fromTemplate } : {}),
          ...(folder ? { folder } : {}),
        }),
      }, { surface: 'form', fallback: 'Failed to create entity' })
      if ('inline' in out) return { ok: false, inline: out.inline }

      await refetch()
      await get().loadFolders(type)
      toast(`Created ${type}: ${name}`, 'success')
      return { ok: true, slug: String(out.body.slug ?? ''), seedPrompt: out.body.seedPrompt as string | undefined }
    },

    createFolder: async ({ type, name, parent }) => {
      const out = await write('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'folder', type, name, ...(parent ? { folder: parent } : {}) }),
      }, { surface: 'form', fallback: 'Failed to create folder' })
      if ('inline' in out) return { ok: false, inline: out.inline }

      await get().loadFolders(type)
      toast(`Created folder: ${name}`, 'success')
      return { ok: true }
    },

    remove: async (target, tabs) => {
      const out = await write(`/api/workspace/${target.type}/${target.slug}`, { method: 'DELETE' },
        { surface: 'bare', fallback: 'Failed to delete entity' })
      if ('inline' in out) return { ok: false, inline: out.inline }

      await refetch()
      toast(`Deleted ${target.type}: ${target.name}`, 'success')

      const { tabs: nextTabs, active } = closeTab(tabs.tabs, tabs.active, tabKey(target))
      return { ok: true, tabs: { tabs: nextTabs, active } }
    },

    move: async (target, folder) => {
      const out = await write(`/api/workspace/${target.type}/${target.slug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder }),
      }, { surface: 'bare', fallback: 'Failed to move entity' })
      if ('inline' in out) return { ok: false, inline: out.inline }

      await refetch()
      await get().loadFolders(target.type)
      toast(`Moved ${target.name} to ${folder || '/'}`, 'success')
      return { ok: true }
    },

    // The plan is fetched before the write, so the user sees which files a rename rewrites
    // and which hold a prose placeholder only they can fix (#54).
    planRename: async (target, to) => {
      const out = await write(
        `/api/workspace/${target.type}/${target.slug}/rename?to=${encodeURIComponent(to)}`,
        { method: 'GET' },
        { surface: 'form', fallback: 'Failed to plan the rename' },
      )
      if ('inline' in out) return { ok: false, inline: out.inline }
      return { ok: true, plan: out.body as unknown as RenamePlan }
    },

    rename: async (target, to, tabs) => {
      const out = await write(`/api/workspace/${target.type}/${target.slug}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to }),
      }, { surface: 'bare', fallback: 'Failed to rename entity' })
      if ('inline' in out) return { ok: false, inline: out.inline }

      await refetch()
      toast(`Renamed ${target.slug} to ${to}`, 'success')

      // The slug is the address, so every open tab pointing at the old one is repointed.
      const next = renameTab(tabs.tabs, tabs.active, tabKey(target),
        { type: target.type as WorkspaceTabType, slug: to })
      return { ok: true, tabs: { tabs: next.tabs, active: next.active } }
    },

    // Rename is cosmetic to the engine (ADR-0012): no preview, no ref-rewrite, just the
    // fs rename. The row holds its own edit field, so a clash lands there (#55).
    renameFolder: async ({ type, folder, name }) => {
      const out = await write('/api/workspace/folders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, folder, name }),
      }, { surface: 'form', fallback: 'Failed to rename folder' })
      if ('inline' in out) return { ok: false, inline: out.inline }

      await get().loadFolders(type)
      await refetch()
      return { ok: true }
    },

    // An empty folder deletes without ceremony; a non-empty one is refused with the file
    // count, which has no dialog to land in and so toasts (#55).
    removeFolder: async ({ type, folder }) => {
      const out = await write(
        `/api/workspace/folders?type=${type}&folder=${encodeURIComponent(folder)}`,
        { method: 'DELETE' },
        { surface: 'bare', fallback: 'Failed to delete folder' },
      )
      if ('inline' in out) return { ok: false, inline: out.inline }

      await get().loadFolders(type)
      toast(`Deleted folder: ${folder.split('/').pop()}`, 'success')
      return { ok: true }
    },
  }
})

/** The stand-in for a type whose folders have not been fetched — one array, so a
 * selector that falls back to it does not re-render on every read. */
export const NO_FOLDERS: string[] = []
