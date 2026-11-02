import { UnpricedBadge } from '@/components/UnpricedBadge'
import type { CostSummary } from '@/lib/runLedger'

/** A cost as the ledger reports it: the priced sum, a badge for what is not, or `unpriced`. */
export function CostCell({ cost, className = '' }: {
  cost: Partial<Pick<CostSummary, 'costUsd' | 'unpricedCount' | 'unpricedModels'>>
  className?: string
}) {
  const models = cost.unpricedModels ?? []
  return (
    <span
      className={`inline-flex items-center gap-1 ${className}`.trim()}
      title={models.length > 0 ? `Unpriced models: ${models.join(', ')}` : undefined}
    >
      {cost.costUsd === undefined ? 'unpriced' : (
        <>
          <span>${cost.costUsd.toFixed(4)}</span>
          <UnpricedBadge count={cost.unpricedCount ?? 0} />
        </>
      )}
    </span>
  )
}
