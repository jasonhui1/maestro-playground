'use client';

/** What a rename would do, as `/api/workspace/[type]/[slug]/rename` reports it (#54). */
export interface RenamePlan {
  from: string;
  to: string;
  rewrites: { slug: string; type: string; fields: string[] }[];
  runs: string[];
  manual: { slug: string; type: string }[];
}

interface RenameDialogProps {
  entityType: string;
  slug: string;
  name: string;
  onNameChange: (name: string) => void;
  /** Null until the plan is fetched — the dialog shows the name field, then the plan. */
  plan: RenamePlan | null;
  error: string | null;
  busy: boolean;
  onPreview: (e: React.FormEvent) => void;
  onBack: () => void;
  onConfirm: () => void;
  onClose: () => void;
}

export default function RenameDialog({
  entityType,
  slug,
  name,
  onNameChange,
  plan,
  error,
  busy,
  onPreview,
  onBack,
  onConfirm,
  onClose,
}: RenameDialogProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-[28rem] p-6 animate-in fade-in zoom-in-95 duration-200">
        <h3 className="text-lg font-semibold text-zinc-900 mb-4">Rename {entityType}</h3>

        {!plan ? (
          <form onSubmit={onPreview}>
            <div className="mb-4">
              <label className="block text-sm font-medium text-zinc-700 mb-1">New name</label>
              <input
                autoFocus
                type="text"
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
                className="w-full px-3 py-2 border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-zinc-500"
                disabled={busy}
              />
              <p className="mt-1 text-xs text-zinc-400">
                The name is the reference — every chain naming <span className="font-mono">{slug}</span> is rewritten.
              </p>
              {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
            </div>
            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 rounded-md transition-colors"
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-sm font-medium text-white bg-zinc-900 hover:bg-zinc-800 rounded-md transition-colors disabled:opacity-50"
                disabled={busy || !name.trim() || name.trim() === slug}
              >
                {busy ? 'Checking...' : 'Continue'}
              </button>
            </div>
          </form>
        ) : (
          <>
            <p className="text-sm text-zinc-600 mb-4">
              <span className="font-mono text-zinc-900">{plan.from}</span>
              {' → '}
              <span className="font-mono text-zinc-900">{plan.to}</span>
            </p>

            <div className="mb-4">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-400 mb-1">
                Rewritten ({plan.rewrites.length})
              </p>
              {plan.rewrites.length === 0 ? (
                <p className="text-sm text-zinc-500 italic">No file references it.</p>
              ) : (
                <ul className="text-sm text-zinc-700 space-y-0.5 max-h-32 overflow-y-auto">
                  {plan.rewrites.map((r) => (
                    <li key={`${r.type}:${r.slug}`} className="flex justify-between gap-3">
                      <span className="font-mono truncate">{r.type}/{r.slug}</span>
                      <span className="text-zinc-400 shrink-0">{r.fields.join(', ')}</span>
                    </li>
                  ))}
                </ul>
              )}
              {plan.runs.length > 0 && (
                <p className="mt-1 text-xs text-zinc-400">
                  {plan.runs.length} past run{plan.runs.length === 1 ? '' : 's'} repointed, so their pinned versions still resolve.
                </p>
              )}
            </div>

            {plan.manual.length > 0 && (
              <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-md">
                <p className="text-xs font-medium text-amber-800 mb-1">Fix by hand ({plan.manual.length})</p>
                <p className="text-xs text-amber-700 mb-2">
                  These name <span className="font-mono">{`{${plan.from}}`}</span> in prompt prose. A prose placeholder
                  is ambiguous, so it is never rewritten for you.
                </p>
                <ul className="text-sm text-amber-900 space-y-0.5 max-h-24 overflow-y-auto">
                  {plan.manual.map((m) => (
                    <li key={`${m.type}:${m.slug}`} className="font-mono truncate">{m.type}/{m.slug}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={onBack}
                className="px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 rounded-md transition-colors"
                disabled={busy}
              >
                Back
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className="px-4 py-2 text-sm font-medium text-white bg-zinc-900 hover:bg-zinc-800 rounded-md transition-colors disabled:opacity-50 flex items-center gap-2"
                disabled={busy}
              >
                {busy && <div className="w-3 h-3 border-2 border-white/20 border-t-white rounded-full animate-spin" />}
                {busy ? 'Renaming...' : 'Rename'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
