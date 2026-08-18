'use client'

// Rendered markdown hides the exact characters the agent emitted, which is the thing you
// need when an output_format looks wrong — so every rendered surface keeps a way back.
export function RenderToggle({ raw, onToggle, labels = ['Rendered', 'Raw'] }: {
  raw: boolean
  onToggle: (raw: boolean) => void
  labels?: [string, string]
}) {
  return (
    <div className="flex items-center rounded-md border border-zinc-200 overflow-hidden shrink-0">
      {([false, true] as const).map((isRaw, i) => (
        <button
          key={labels[i]}
          onClick={() => onToggle(isRaw)}
          aria-pressed={raw === isRaw}
          className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 transition-colors ${
            raw === isRaw ? 'bg-zinc-900 text-white' : 'text-zinc-400 hover:bg-zinc-50'
          }`}
        >
          {labels[i]}
        </button>
      ))}
    </div>
  )
}
