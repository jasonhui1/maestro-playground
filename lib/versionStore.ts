import { calculateHash, getVersionContent, listVersions, snapshotVersion, type VersionEntry } from './fs/versions'
import type { TouchedFile } from './runVersionModel'

export type { VersionEntry }

type FileType = TouchedFile['type']

/** The numbered snapshots under `.versions/<type>/<slug>/` (ADR-0011). */
export interface VersionStore {
  /** The version holding `content`: the latest when it matches, else a new one written now. */
  snapshot(type: FileType, slug: string, content: string): number
  /** A file's bytes at `version`; null when that version is gone. */
  read(type: FileType, slug: string, version: number): string | null
  /** Newest first. */
  list(type: FileType, slug: string): VersionEntry[]
}

/** What snapshotting and pinned reads need of a workspace; a `Workspace` is one. */
export interface VersionedRoot {
  root: string
  versions: VersionStore
}

export function diskVersionStore(root: string): VersionStore {
  return {
    snapshot: (type, slug, content) => snapshotVersion(root, type, slug, content),
    read: (type, slug, version) => getVersionContent(root, type, slug, version),
    list: (type, slug) => listVersions(root, type, slug),
  }
}

export function memoryVersionStore(): VersionStore {
  const files = new Map<string, { entry: VersionEntry; content: string }[]>()
  const of = (type: FileType, slug: string) => files.get(`${type}/${slug}`) ?? []
  return {
    snapshot(type, slug, content) {
      const versions = of(type, slug)
      const hash = calculateHash(content)
      const latest = versions.at(-1)
      if (latest?.entry.hash === hash) return latest.entry.version
      const version = versions.length + 1
      files.set(`${type}/${slug}`, [...versions, { entry: { version, timestamp: new Date().toISOString(), hash }, content }])
      return version
    },
    read: (type, slug, version) => of(type, slug).find(v => v.entry.version === version)?.content ?? null,
    list: (type, slug) => of(type, slug).map(v => v.entry).reverse(),
  }
}
