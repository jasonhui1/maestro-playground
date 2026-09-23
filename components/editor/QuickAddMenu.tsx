'use client'
import React, { useEffect, useRef, useState } from 'react'

export type QuickAddItem =
  | { type: 'agent'; slug: string }
  | { type: 'source-seed' }
  | { type: 'source-context'; file?: string }
  | { type: 'control-loop' }
  | { type: 'control-gate' }

export interface QuickAddMenuProps {
  pos: { clientX: number; clientY: number }
  agents: { slug: string; name: string }[]
  contextFiles: { slug: string; name: string }[]
  onClose: () => void
  onSelect: (item: QuickAddItem) => void
}

export default function QuickAddMenu({
  pos,
  agents,
  contextFiles,
  onClose,
  onSelect,
}: QuickAddMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [activeCategory, setActiveCategory] = useState<'agents' | 'sources' | 'control'>('agents')

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as HTMLElement)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [onClose])

  const left = typeof window !== 'undefined' ? Math.min(pos.clientX, window.innerWidth - 340) : pos.clientX
  const top = typeof window !== 'undefined' ? Math.min(pos.clientY, window.innerHeight - 260) : pos.clientY

  return (
    <div
      ref={menuRef}
      style={{ left, top }}
      className="nodrag nopan fixed z-50 flex bg-white border border-zinc-200 rounded-lg shadow-xl overflow-hidden font-sans text-xs w-[320px] divide-x divide-zinc-100"
    >
      <div className="w-[110px] p-1 bg-zinc-50 flex flex-col gap-0.5">
        <button
          type="button"
          onMouseEnter={() => setActiveCategory('agents')}
          onClick={() => setActiveCategory('agents')}
          className={`flex items-center justify-between px-2 py-1.5 rounded text-left transition-colors ${
            activeCategory === 'agents' ? 'bg-zinc-200 text-zinc-900 font-semibold' : 'text-zinc-600 hover:bg-zinc-100'
          }`}
        >
          <span>Agents</span>
          <span className="text-zinc-400">›</span>
        </button>
        <button
          type="button"
          onMouseEnter={() => setActiveCategory('sources')}
          onClick={() => setActiveCategory('sources')}
          className={`flex items-center justify-between px-2 py-1.5 rounded text-left transition-colors ${
            activeCategory === 'sources' ? 'bg-zinc-200 text-zinc-900 font-semibold' : 'text-zinc-600 hover:bg-zinc-100'
          }`}
        >
          <span>Sources</span>
          <span className="text-zinc-400">›</span>
        </button>
        <button
          type="button"
          onMouseEnter={() => setActiveCategory('control')}
          onClick={() => setActiveCategory('control')}
          className={`flex items-center justify-between px-2 py-1.5 rounded text-left transition-colors ${
            activeCategory === 'control' ? 'bg-zinc-200 text-zinc-900 font-semibold' : 'text-zinc-600 hover:bg-zinc-100'
          }`}
        >
          <span>Control</span>
          <span className="text-zinc-400">›</span>
        </button>
      </div>

      <div className="flex-1 p-1 max-h-[240px] overflow-y-auto flex flex-col gap-0.5 bg-white">
        {activeCategory === 'agents' && (
          agents.length > 0 ? (
            agents.map(a => {
              const label = a.slug.endsWith('.md') ? a.slug : `${a.slug}.md`
              return (
                <button
                  key={a.slug}
                  type="button"
                  onClick={() => onSelect({ type: 'agent', slug: a.slug })}
                  className="px-2 py-1.5 rounded text-left text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 truncate font-mono text-xs"
                  title={label}
                >
                  {label}
                </button>
              )
            })
          ) : (
            <div className="p-2 text-zinc-400 text-xs italic">No agents available</div>
          )
        )}

        {activeCategory === 'sources' && (
          <>
            <button
              type="button"
              onClick={() => onSelect({ type: 'source-seed' })}
              className="px-2 py-1.5 rounded text-left text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 text-xs"
            >
              Seed Node
            </button>
            <button
              type="button"
              onClick={() => onSelect({ type: 'source-context', file: contextFiles[0]?.slug })}
              className="px-2 py-1.5 rounded text-left text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 text-xs"
            >
              Context File
            </button>
            {contextFiles.length > 0 && (
              <div className="pt-1 mt-1 border-t border-zinc-100 flex flex-col gap-0.5">
                {contextFiles.map(f => (
                  <button
                    key={f.slug}
                    type="button"
                    onClick={() => onSelect({ type: 'source-context', file: f.slug })}
                    className="px-2 py-1 rounded text-left text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 text-xs truncate"
                    title={f.name}
                  >
                    ↳ {f.name}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {activeCategory === 'control' && (
          <>
            <button
              type="button"
              onClick={() => onSelect({ type: 'control-loop' })}
              className="px-2 py-1.5 rounded text-left text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 text-xs"
            >
              Loop Zone
            </button>
            <button
              type="button"
              onClick={() => onSelect({ type: 'control-gate' })}
              className="px-2 py-1.5 rounded text-left text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 text-xs"
            >
              Gate Node
            </button>
          </>
        )}
      </div>
    </div>
  )
}
