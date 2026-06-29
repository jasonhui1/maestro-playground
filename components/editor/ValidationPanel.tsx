'use client'
import React from 'react'
import type { ValidationIssue } from '@/lib/types'

export default function ValidationPanel({ issues, onSelect }: {
  issues: ValidationIssue[]
  onSelect: (id: string | null) => void
}) {
  if (issues.length === 0) {
    return <div className="px-4 py-2 text-[11px] text-green-600 border-t border-zinc-100">✓ No validation issues</div>
  }
  const errorCount = issues.filter(i => i.severity === 'error').length
  const hasErrors = errorCount > 0
  return (
    <div className={`border-t border-zinc-100 max-h-32 overflow-auto ${hasErrors ? 'bg-red-50/40' : 'bg-amber-50/40'}`}>
      <div className={`px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest ${hasErrors ? 'text-red-600' : 'text-amber-600'}`}>
        {errorCount > 0 && `${errorCount} error(s)`}
        {errorCount > 0 && issues.length > errorCount && ', '}
        {issues.length > errorCount && `${issues.length - errorCount} warning(s)`}
      </div>
      <ul className="px-2 pb-2 space-y-0.5">
        {issues.map((i, idx) => {
          const warn = i.severity === 'warning'
          return (
            <li key={idx}>
              <button
                onClick={() => onSelect(i.nodeId ?? i.edge?.toNode ?? null)}
                className={`w-full text-left text-[11px] rounded px-2 py-0.5 ${warn ? 'text-amber-700 hover:bg-amber-100/60' : 'text-red-700 hover:bg-red-100/60'}`}
              >
                {warn ? '⚠ ' : ''}{i.message}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
