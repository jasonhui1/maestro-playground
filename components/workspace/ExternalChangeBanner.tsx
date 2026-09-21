'use client'
import type { ConflictChoice } from '@/lib/editedFile'

/** Shown when the open file changed on disk while the buffer held unsaved edits (#121). */
export default function ExternalChangeBanner({ conflict, resolve }: {
  conflict: string | null
  resolve: (choice: ConflictChoice) => void
}) {
  if (conflict === null) return null
  return (
    <div className="px-4 py-1.5 text-[11px] text-amber-700 bg-amber-50 border-b border-amber-100 flex items-center gap-3">
      <span>This file changed on disk.</span>
      <button className="font-bold underline" onClick={() => resolve('theirs')}>Reload from disk</button>
      <button className="font-bold underline" onClick={() => resolve('mine')}>Keep my version</button>
    </div>
  )
}
