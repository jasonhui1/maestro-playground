/**
 * The result view's type scale (#65). Five steps with one job each, so a panel label and
 * a metric are not two ad-hoc bracket sizes that happen to differ.
 */
export const TYPE = {
  /** A panel or rail heading: small, spaced, upper. */
  label: 'text-[11px] uppercase tracking-[0.14em]',
  /** Line counts, cost, elapsed — figures read as figures. */
  metric: 'text-[10px] font-mono',
  /** Agent output and its lead lines. */
  body: 'text-[13px] leading-[1.7]',
  /** Controls, headings inside the rail, anything the reader operates. */
  ui: 'text-xs',
  /** The run's name — the largest thing the frame says. */
  title: 'text-sm font-semibold',
} as const
