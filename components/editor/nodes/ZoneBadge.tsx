'use client'
import React, { useState, useEffect, useRef, useId } from 'react'
import { Link2, Pencil, Check, X } from 'lucide-react'

interface ZoneBadgeProps {
  zone?: string
  onChange: (newZone: string) => void
  readOnly?: boolean
  availableZones?: string[]
}

// Linked badge for loop zone boundaries (#144).
export default function ZoneBadge({
  zone,
  onChange,
  readOnly = false,
  availableZones = [],
}: ZoneBadgeProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(zone ?? '')
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  useEffect(() => {
    if (!editing) setDraft(zone ?? '')
  }, [zone, editing])

  const commit = () => {
    setEditing(false)
    const next = draft.trim()
    if (next !== (zone ?? '')) {
      onChange(next)
    }
  }

  const cancel = () => {
    setDraft(zone ?? '')
    setEditing(false)
  }

  if (editing && !readOnly) {
    return (
      <div className="nodrag flex items-center gap-1 mb-2">
        <div className="relative inline-flex items-center">
          <input
            ref={inputRef}
            type="text"
            list={listId}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commit()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                cancel()
              }
            }}
            onBlur={commit}
            className="w-28 text-xs font-mono border border-amber-400 focus:border-amber-500 rounded-md px-2 py-0.5 bg-white text-zinc-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
            placeholder="zone slug"
            autoFocus
          />
          {availableZones.length > 0 && (
            <datalist id={listId}>
              {availableZones.map(z => (
                <option key={z} value={z} />
              ))}
            </datalist>
          )}
        </div>
        <button
          type="button"
          onMouseDown={e => {
            e.preventDefault()
            commit()
          }}
          title="Apply zone"
          aria-label="Apply zone"
          className="p-1 rounded text-amber-800 hover:bg-amber-200/60"
        >
          <Check size={12} />
        </button>
        <button
          type="button"
          onMouseDown={e => {
            e.preventDefault()
            cancel()
          }}
          title="Cancel"
          aria-label="Cancel"
          className="p-1 rounded text-zinc-500 hover:bg-zinc-200"
        >
          <X size={12} />
        </button>
      </div>
    )
  }

  return (
    <div className="mb-2">
      <button
        type="button"
        disabled={readOnly}
        onClick={() => {
          if (!readOnly) setEditing(true)
        }}
        className={`nodrag inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-medium border shadow-xs transition-all ${
          !zone
            ? 'bg-red-50 text-red-700 border-red-300 hover:bg-red-100'
            : 'bg-amber-100/80 text-amber-900 border-amber-300 hover:bg-amber-200/80'
        } ${readOnly ? 'cursor-default' : 'cursor-pointer group'}`}
        title={
          readOnly
            ? `Zone: ${zone || 'unassigned'}`
            : `Zone: ${zone || 'unassigned'} (click to rename or select)`
        }
      >
        <Link2 size={12} className={!zone ? 'text-red-500 shrink-0' : 'text-amber-700 shrink-0'} />
        <span className="truncate max-w-[130px] font-semibold">{zone || 'unassigned'}</span>
        {!readOnly && (
          <Pencil size={10} className="text-amber-600/50 group-hover:text-amber-800 shrink-0 ml-0.5" />
        )}
      </button>
    </div>
  )
}
