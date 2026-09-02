'use client'
import { Copy } from 'lucide-react'
import { useToastStore } from '@/hooks/store/useToastStore'

/** Copies the source text the engine carried, not the rendered markdown — what lands in
 *  the editor is what the next hop received (#65). */
export function CopyButton({ text, label, className = '' }: {
  text: string
  label: string
  className?: string
}) {
  const addToast = useToastStore(state => state.addToast)

  return (
    <button
      type="button"
      aria-label={label}
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        addToast('copied', 'success')
      }}
      className={`text-zinc-400 hover:text-zinc-900 outline-none rounded
        focus-visible:ring-2 focus-visible:ring-zinc-900 ${className}`}
    >
      <Copy size={14} />
    </button>
  )
}
