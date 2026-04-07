'use client'
import { TemplateDef } from '@/lib/types'

interface Props {
  templates: TemplateDef[]
  onSelect: (template: TemplateDef) => void
}

export function TemplateSelector({ templates, onSelect }: Props) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
        Template
      </label>
      <select
        onChange={e => {
          const t = templates.find(t => t.name === e.target.value)
          if (t) onSelect(t)
        }}
        defaultValue=""
        className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm"
      >
        <option value="" disabled>Select a template...</option>
        {templates.map(t => (
          <option key={t.name} value={t.name}>{t.name}</option>
        ))}
      </select>
    </div>
  )
}
