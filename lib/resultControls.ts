/** The two control skins the result surface reuses, so a field or a secondary button
 *  cannot drift between the launch form and the run's own chrome (#65). */
export const CONTROL = {
  field: `rounded-lg border border-zinc-300 px-3 py-2 text-sm
    placeholder:text-zinc-500 focus:ring-2 focus:ring-zinc-900 outline-none`,
  secondary: `rounded-lg border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700
    hover:bg-zinc-100 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-zinc-900`,
} as const
