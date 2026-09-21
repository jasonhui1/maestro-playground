'use client'
import { useMemo } from 'react'
import { useWorkspaceStore } from '@/hooks/store/useWorkspaceStore'
import { PRICED_MODELS } from '@/lib/pricing'
import { CONTROL } from '@/lib/resultControls'

export interface ModelPickerProps {
  value: string
  onChange: (value: string) => void
  models?: string[]
  envOverride?: boolean
  id?: string
  name?: string
  className?: string
  ariaLabel?: string
  disabled?: boolean
}

// #128: Shared model dropdown across launch, resume, and fork surfaces.
export function ModelPicker({
  value,
  onChange,
  models: propModels,
  envOverride: propEnvOverride,
  id,
  name,
  className,
  ariaLabel = 'model override',
  disabled,
}: ModelPickerProps) {
  const storeModels = useWorkspaceStore(s => s.files.models)
  const storeEnvOverride = useWorkspaceStore(s => s.files.envModelOverride)

  const isEnvOverride = propEnvOverride ?? storeEnvOverride ?? false
  const catalogue = useMemo(() => {
    const list = propModels ?? (storeModels && storeModels.length > 0 ? storeModels : PRICED_MODELS)
    const set = new Set(list)
    if (value && value.trim()) set.add(value.trim())
    return Array.from(set)
  }, [propModels, storeModels, value])

  const defaultLabel = isEnvOverride ? 'As declared (env override)' : 'As declared'

  return (
    <select
      id={id}
      name={name}
      aria-label={ariaLabel}
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      className={className ?? `${CONTROL.field} text-xs font-mono`}
    >
      <option value="">{defaultLabel}</option>
      {catalogue.map(m => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
    </select>
  )
}
