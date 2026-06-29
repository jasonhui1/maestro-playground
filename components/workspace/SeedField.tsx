'use client'
import React, { useState } from 'react'

export default function SeedField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative flex-1 min-w-[120px] max-w-[420px]">
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setOpen(false)}
        placeholder="Seed prompt ({input})…"
        className="w-full text-xs border border-zinc-200 rounded px-2 py-1"
      />
      <button
        onClick={() => setOpen(o => !o)}
        className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] text-zinc-400 hover:text-zinc-700"
      >
        ⤢
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-[420px] bg-white border border-zinc-200 rounded-md shadow-lg p-2">
          <textarea
            value={value}
            onChange={e => onChange(e.target.value)}
            rows={6}
            autoFocus
            className="w-full text-xs border border-zinc-100 rounded p-2 resize-none"
            placeholder="Seed prompt ({input})…"
          />
        </div>
      )}
    </div>
  )
}
