'use client'
import React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export default function InstanceSwitcher({ count, index, onChange }: {
  count: number; index: number; onChange: (i: number) => void
}) {
  if (count <= 1) return null
  return (
    <div className="flex items-center gap-1 text-[11px] text-zinc-500">
      <button className="p-0.5 hover:text-zinc-900 disabled:opacity-30" disabled={index <= 0}
        onClick={() => onChange(index - 1)} aria-label="Previous instance"><ChevronLeft size={14} /></button>
      <span className="font-mono tabular-nums">{index + 1}/{count}</span>
      <button className="p-0.5 hover:text-zinc-900 disabled:opacity-30" disabled={index >= count - 1}
        onClick={() => onChange(index + 1)} aria-label="Next instance"><ChevronRight size={14} /></button>
    </div>
  )
}
