import Link from 'next/link'
import type { VarianceGroup } from '@/lib/variance'

export function VarianceRunCard({ group }: { group: VarianceGroup }) {
  const widest = group.nodes.reduce((max, node) => Math.max(max, node.spread ?? 0), 0)
  return (
    <Link
      href={`/variance/${encodeURIComponent(group.groupId)}`}
      className="group block rounded-xl border border-zinc-300 bg-zinc-50 p-5 shadow-sm transition-all hover:border-zinc-500 hover:shadow-md"
    >
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-zinc-900">{group.chainName}</h3>
            <span className="rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">
              variance ×{group.expectedRunCount}
            </span>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-tight text-zinc-400">{group.groupId}</span>
        </div>
        <span className="font-mono text-xs text-zinc-700">widest {widest.toFixed(2)}</span>
      </div>
      <p className="mb-5 line-clamp-2 text-sm italic leading-relaxed text-zinc-600">&quot;{group.seedPrompt}&quot;</p>
      <div className="flex items-center justify-between border-t border-zinc-200 pt-4 text-[11px] text-zinc-500">
        <span>{group.completedRunCount} of {group.expectedRunCount} complete · {group.nodes.length} nodes</span>
        <span className="font-medium text-zinc-900">
          {group.costUsd !== undefined ? `$${group.costUsd.toFixed(4)}` : 'unpriced'}
        </span>
      </div>
    </Link>
  )
}
