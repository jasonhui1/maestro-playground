'use client'
import React, { memo } from 'react'
import { type NodeProps, type Node } from '@xyflow/react'

export interface ZoneFrameData { zone: string; width: number; height: number; [key: string]: unknown }

function ZoneFrame({ data }: NodeProps<Node<ZoneFrameData>>) {
  return (
    <div
      style={{ width: data.width, height: data.height }}
      className="rounded-2xl border-2 border-dashed border-amber-300 bg-amber-100/20 pointer-events-none"
    >
      <span className="absolute -top-2 left-3 px-1.5 bg-amber-100 text-amber-700 text-[9px] font-bold uppercase tracking-widest rounded">
        loop: {data.zone}
      </span>
    </div>
  )
}
export default memo(ZoneFrame)
