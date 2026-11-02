import { getVersionContent, listVersions, snapshotVersion } from './fs/versions'
import type { TouchedFile } from './runVersionModel'

type FileType = TouchedFile['type']

export interface VersionEntry {
  version: number
  timestamp: string
  hash: string
}

/** The numbered snapshots under `.versions/<type>/<slug>/` (ADR-0011). */
export interface VersionStore {
  /** The version holding `content`: the latest when it matches, else a new one written now. */
  snapshot(type: FileType, slug: string, content: string): number
  /** A file's bytes at `version`; null when that version is gone. */
  read(type: string, slug: string, version: number): string | null
  /** Newest first. */
  list(type: string, slug: string): VersionEntry[]
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
  const of = (type: string, slug: string) => files.get(`${type}/${slug}`) ?? []
  return {
    snapshot(type, slug, content) {
      const versions = of(type, slug)
      const latest = versions.at(-1)
      if (latest?.content === content) return latest.entry.version
      const version = versions.length + 1
      files.set(`${type}/${slug}`, [...versions, { entry: { version, timestamp: new Date().toISOString(), hash: '' }, content }])
      return version
    },
    read: (type, slug, version) => of(type, slug).find(v => v.entry.version === version)?.content ?? null,
    list: (type, slug) => of(type, slug).map(v => v.entry).reverse(),
  }
}
