// #145
export function UnpricedBadge({
  count,
  title,
  className = '',
}: {
  count: number
  title?: string
  className?: string
}) {
  if (count <= 0) return null
  return (
    <span
      title={title}
      className={`text-[10px] px-1 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-sans font-normal ${className}`.trim()}
    >
      (+{count} unpriced)
    </span>
  )
}

export default UnpricedBadge
