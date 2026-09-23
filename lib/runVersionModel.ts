/** One workspace file a run reached, with the bytes a version hashes (ADR-0011). */
export interface TouchedFile {
  type: 'chain' | 'agent' | 'skill' | 'context' | 'tool' | 'defaults'
  /** Empty for the defaults file, which is a single file rather than a type folder. */
  slug: string
  content: string
}

/** `type/slug`, or the bare type for the single-file defaults. */
export function versionKey(type: TouchedFile['type'], slug: string): string {
  return slug ? `${type}/${slug}` : type
}

/** Inverse of {@link versionKey}, for reading a `RunMeta.versions` entry back into a lookup. */
export function parseVersionKey(key: string): { type: TouchedFile['type']; slug: string } {
  const slash = key.indexOf('/')
  if (slash === -1) return { type: key as TouchedFile['type'], slug: '' }
  return { type: key.slice(0, slash) as TouchedFile['type'], slug: key.slice(slash + 1) }
}
