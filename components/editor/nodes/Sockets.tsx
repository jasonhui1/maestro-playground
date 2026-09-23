'use client'
import React, { useState, useEffect, useRef } from 'react'
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

// Slot literal popover editor (#141)
function SlotLiteralPopover({
  handleId,
  node,
  onChange,
  readOnly,
  isSet,
  value,
}: {
  handleId: string
  node?: ChainNode
  onChange?: (patch: Partial<ChainNode>) => void
  readOnly?: boolean
  isSet: boolean
  value: string
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) setDraft(value)
  }, [open, value])

  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as HTMLElement)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  const handleSave = () => {
    const next = { ...(node?.inputs ?? {}), [handleId]: draft }
    onChange?.({ inputs: next })
    setOpen(false)
  }

  const handleClear = () => {
    const next = { ...(node?.inputs ?? {}) }
    delete next[handleId]
    onChange?.({ inputs: Object.keys(next).length > 0 ? next : undefined })
    setOpen(false)
  }

  const handleCancel = () => {
    setOpen(false)
  }

  const displayValue = value.length > 10 ? `${value.slice(0, 10)}…` : value

  return (
    <div className="relative ml-1.5 flex items-center min-w-0">
      {!isSet ? (
        <button
          type="button"
          disabled={readOnly}
          onClick={() => {
            setDraft(value)
            setOpen(true)
          }}
          className="nodrag text-xs font-mono text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 border border-dashed border-zinc-300 hover:border-zinc-400 rounded px-1.5 py-0.5 transition-colors disabled:opacity-50"
        >
          + literal
        </button>
      ) : (
        <button
          type="button"
          disabled={readOnly}
          onClick={() => {
            setDraft(value)
            setOpen(true)
          }}
          title={value}
          className="nodrag inline-flex items-center text-xs font-mono text-zinc-700 hover:text-zinc-900 bg-zinc-100 hover:bg-zinc-200 border border-zinc-300 rounded px-1.5 py-0.5 transition-colors max-w-[120px] disabled:opacity-50"
        >
          <span className="truncate">{`["${displayValue}" ✎]`}</span>
        </button>
      )}

      {open && (
        <div
          ref={popoverRef}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              handleCancel()
            }
          }}
          className="nodrag nopan absolute left-0 top-full mt-1 z-50 w-64 bg-white border border-zinc-200 rounded-lg shadow-xl p-3 text-left font-sans"
        >
          <div className="text-xs font-semibold text-zinc-700 mb-1.5 flex items-center justify-between">
            <span>Literal for <span className="font-mono text-zinc-900">{handleId}</span></span>
          </div>
          <textarea
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                handleSave()
              }
            }}
            placeholder="Enter literal value…"
            rows={3}
            className="nodrag w-full text-xs font-mono border border-zinc-200 focus:border-zinc-400 rounded p-1.5 mb-2 focus:outline-none focus:ring-1 focus:ring-zinc-400 resize-y text-zinc-900 bg-white"
          />
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleSave}
              className="nodrag px-2.5 py-1 text-xs font-medium text-white bg-zinc-900 hover:bg-zinc-800 rounded transition-colors"
            >
              Save
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="nodrag px-2.5 py-1 text-xs font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 rounded transition-colors"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="nodrag ml-auto px-2.5 py-1 text-xs font-medium text-zinc-500 hover:text-zinc-800 rounded transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
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
              <SlotLiteralPopover
                handleId={h.id}
                node={node}
                onChange={onChange}
                readOnly={readOnly}
                isSet={isSet}
                value={literalValue}
              />
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
    <div className="flex justify-between gap-4 text-xs font-mono text-zinc-500">
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
