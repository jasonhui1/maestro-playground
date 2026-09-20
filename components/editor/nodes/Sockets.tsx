'use client'
import React from 'react'
import { Handle, Position } from '@xyflow/react'
import { inputHandles, outputHandles, type SocketHandle } from '@/lib/nodeSockets'

/** Loop nodes wear the zone's amber; `muted` marks a fallback slot, like a branch's default. */
export type SocketTone = 'default' | 'loop' | 'muted'

const FILL: Record<SocketTone, Record<SocketHandle['side'], string>> = {
  default: { input: '!bg-zinc-400', output: '!bg-zinc-900' },
  loop: { input: '!bg-amber-400', output: '!bg-amber-500' },
  muted: { input: '!bg-zinc-300', output: '!bg-zinc-500' },
}
const HOLLOW: Record<SocketTone, string> = {
  default: 'border-zinc-400', loop: 'border-amber-400', muted: 'border-zinc-300',
}

function dotClass(handle: SocketHandle, tone: SocketTone): string {
  const shape = handle.multi ? 'w-4 h-2.5 rounded-sm' : 'w-2.5 h-2.5'
  const skin = handle.optional
    ? `${HOLLOW[tone]} !bg-white`
    : `border-white ${FILL[tone][handle.side]}`
  return `${shape} border-2 ${skin}`
}

function dotTitle(handle: SocketHandle): string {
  if (handle.optional) return `${handle.id} (optional)`
  if (handle.multi) return `${handle.id} (accepts many)`
  return handle.id
}

/**
 * The app's only `<Handle>` (#114). The dot is centred on whatever row hosts it, so
 * that row must be `relative`.
 */
export function SocketDot({ handle, tone = 'default' }: { handle: SocketHandle; tone?: SocketTone }) {
  const isInput = handle.side === 'input'
  return (
    <Handle
      type={isInput ? 'target' : 'source'}
      id={handle.id}
      position={isInput ? Position.Left : Position.Right}
      title={dotTitle(handle)}
      style={{ [isInput ? 'left' : 'right']: -16, top: '50%', transform: 'translateY(-50%)' }}
      className={dotClass(handle, tone)}
    />
  )
}

/** One labelled column of sockets — inputs read `name`, outputs read `.name`. */
export function SocketList({ handles, tone = 'default' }: { handles: SocketHandle[]; tone?: SocketTone }) {
  return (
    <div className="flex flex-col gap-1.5">
      {handles.map(h => {
        const isInput = h.side === 'input'
        const label = isInput ? h.id : `.${h.id}`
        return (
          <div
            key={h.id}
            className={`relative flex items-center h-5 ${isInput ? 'pl-3' : 'pr-3 justify-end text-right'}`}
          >
            {isInput && <SocketDot handle={h} tone={tone} />}
            <span className="truncate max-w-[100px]" title={isInput ? dotTitle(h) : label}>{label}</span>
            {!isInput && <SocketDot handle={h} tone={tone} />}
          </div>
        )
      })}
    </div>
  )
}

/** The default socket block: inputs down the left edge, outputs down the right. */
export function Sockets({ handles, tone = 'default' }: { handles: SocketHandle[]; tone?: SocketTone }) {
  return (
    <div className="flex justify-between gap-4 text-[9px] font-mono text-zinc-400">
      <SocketList handles={inputHandles(handles)} tone={tone} />
      <SocketList handles={outputHandles(handles)} tone={tone} />
    </div>
  )
}
