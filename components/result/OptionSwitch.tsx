'use client'

/** A labelled row of mutually exclusive options, shared by the result page and a run
 *  reopened from history so the two surfaces cannot drift. */
export function OptionSwitch<T extends string>({ label, options, value, onChange }: {
  label: string
  options: { id: T; label: string }[]
  value: T
  onChange: (next: T) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs">
      <span className="text-zinc-400 mr-1">{label}</span>
      {options.map(o => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={`rounded-full border px-3 py-1 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-zinc-900
            ${value === o.id ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
