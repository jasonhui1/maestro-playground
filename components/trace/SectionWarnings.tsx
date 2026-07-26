'use client'
import { AlertTriangle } from 'lucide-react'
import { sectionWarningText } from '@/lib/sectionWarning'
import type { SectionWarning } from '@/lib/sectionWarning'

// A marker, not an alarm: the run continues and the node still succeeded (#37).
export function SectionWarnings({ warnings }: { warnings: SectionWarning[] }) {
  if (warnings.length === 0) return null
  return (
    <div className="flex flex-col gap-1 px-4 py-2 border-b border-amber-100 bg-amber-50/50">
      {warnings.map((w, i) => (
        <div key={i} className="flex items-start gap-1.5 text-[11px] text-amber-700">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" />
          <span>{sectionWarningText(w)}</span>
        </div>
      ))}
    </div>
  )
}
