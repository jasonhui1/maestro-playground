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
  return (
    <div className="border-t border-zinc-100 bg-red-50/40 max-h-32 overflow-auto">
      <div className="px-4 py-1.5 text-[10px] font-bold text-red-600 uppercase tracking-widest">{issues.length} issue(s)</div>
      <ul className="px-2 pb-2 space-y-0.5">
        {issues.map((i, idx) => (
          <li key={idx}>
            <button
              onClick={() => onSelect(i.nodeId ?? i.edge?.toNode ?? null)}
              className="w-full text-left text-[11px] text-red-700 hover:bg-red-100/60 rounded px-2 py-0.5"
            >
              {i.message}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
