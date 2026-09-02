'use client'
import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

/** Copies the source text the engine carried, not the rendered markdown — what lands in
 *  the editor is what the next hop received (vision.md: easy to copy). */
export function CopyButton({ text, label = 'copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <button
      type="button"
      aria-label={label}
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      }}
      className="text-zinc-400 hover:text-zinc-900 outline-none rounded focus-visible:ring-2 focus-visible:ring-zinc-900"
    >
      {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
    </button>
  )
}
