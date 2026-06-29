'use client'
import React, { useState } from 'react'
import InterfacePanel from './InterfacePanel'
import type { ChainNode, ChainPort } from '@/lib/types'

export default function InterfacePopover({ nodes, inputs, outputs, onChange }: {
  nodes: ChainNode[]; inputs: ChainPort[]; outputs: ChainPort[]
  onChange: (iface: { inputs: ChainPort[]; outputs: ChainPort[] }) => void
}) {
  const [open, setOpen] = useState(false)
  const count = inputs.length + outputs.length
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} className="px-2 py-1 text-xs rounded-md border border-zinc-200 text-zinc-600 hover:bg-zinc-50">
        Interface{count ? ` (${count})` : ''} ▾
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-[460px] bg-white border border-zinc-200 rounded-md shadow-lg">
          <InterfacePanel nodes={nodes} inputs={inputs} outputs={outputs} onChange={onChange} />
        </div>
      )}
    </div>
  )
}
