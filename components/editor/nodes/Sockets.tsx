'use client'
import React from 'react'
import { Handle, Position } from '@xyflow/react'
import { inputHandles, outputHandles, type SocketHandle } from '@/lib/nodeSockets'
import type { ChainNode } from '@/lib/types'
import { hasLiteralInput } from '@/lib/chainGraph'

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
export function SocketList({
  handles,
  tone = 'default',
  node,
  onChange,
  readOnly,
  wiredSockets,
}: {
  handles: SocketHandle[]
  tone?: SocketTone
  node?: ChainNode
  onChange?: (patch: Partial<ChainNode>) => void
  readOnly?: boolean
  wiredSockets?: Set<string>
}) {
  return (
    <div className="flex flex-col gap-1.5 flex-1 min-w-0">
      {handles.map(h => {
        const isInput = h.side === 'input'
        const label = isInput ? h.id : `.${h.id}`
        const isWired = isInput && (wiredSockets?.has(h.id) ?? false)
        const isInputNodeKind = node?.kind === 'agent' || node?.kind === 'decider'
        const showLiteralInput = isInput && !isWired && isInputNodeKind && onChange !== undefined
        const isSet = isInput && hasLiteralInput(node, h.id)
        const literalValue = isSet ? (node!.inputs![h.id] ?? '') : ''

        return (
          <div
            key={h.id}
            className={`relative flex items-center min-h-[22px] py-0.5 ${isInput ? 'pl-3' : 'pr-3 justify-end text-right'}`}
          >
            {isInput && <SocketDot handle={h} tone={tone} />}
            <span className="truncate max-w-[80px]" title={isInput ? dotTitle(h) : label}>{label}</span>
            {showLiteralInput && (
              <div className="ml-1.5 flex items-center gap-1 flex-1 min-w-0">
                <input
                  type="text"
                  value={literalValue}
                  onChange={e => {
                    const next = { ...(node?.inputs ?? {}), [h.id]: e.target.value }
                    onChange({ inputs: next })
                  }}
                  disabled={readOnly}
                  placeholder="unset"
                  className={`w-full nodrag px-1.5 py-0.5 text-[10px] font-sans rounded border transition-colors ${
                    isSet
                      ? 'border-zinc-300 bg-white text-zinc-900 focus:border-zinc-800'
                      : 'border-zinc-200 border-dashed bg-zinc-50/50 text-zinc-400 placeholder:text-zinc-300'
                  }`}
                />
                {isSet && !readOnly && (
                  <button
                    type="button"
                    title="Unset literal"
                    onClick={() => {
                      const next = { ...(node?.inputs ?? {}) }
                      delete next[h.id]
                      onChange({ inputs: Object.keys(next).length > 0 ? next : undefined })
                    }}
                    className="nodrag text-zinc-400 hover:text-zinc-700 text-[10px] px-0.5 font-sans"
                  >
                    ✕
                  </button>
                )}
              </div>
            )}
            {!isInput && <SocketDot handle={h} tone={tone} />}
          </div>
        )
      })}
    </div>
  )
}

/** The default socket block: inputs down the left edge, outputs down the right. */
export function Sockets({
  handles,
  tone = 'default',
  node,
  onChange,
  readOnly,
  wiredSockets,
}: {
  handles: SocketHandle[]
  tone?: SocketTone
  node?: ChainNode
  onChange?: (patch: Partial<ChainNode>) => void
  readOnly?: boolean
  wiredSockets?: Set<string>
}) {
  return (
    <div className="flex justify-between gap-4 text-[9px] font-mono text-zinc-400">
      <SocketList
        handles={inputHandles(handles)}
        tone={tone}
        node={node}
        onChange={onChange}
        readOnly={readOnly}
        wiredSockets={wiredSockets}
      />
      <SocketList handles={outputHandles(handles)} tone={tone} />
    </div>
  )
}
