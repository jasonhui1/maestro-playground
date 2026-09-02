'use client'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Agent output is markdown by convention, so every surface that shows it renders through
// here — one type scale, one table style. Raw HTML stays off: model output is untrusted.
/** `output` renders agent prose in the mono face — it is content, not UI (vision.md). */
export function Markdown({ children, className = '', tone = 'ui' }: {
  children: string
  className?: string
  tone?: 'ui' | 'output'
}) {
  return (
    <div className={`text-sm text-zinc-700 leading-relaxed break-words
      ${tone === 'output' ? 'font-mono text-[13px] leading-[1.7]' : ''} ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: p => <h1 className="text-base font-bold text-zinc-900 mt-4 mb-2 first:mt-0" {...p} />,
          h2: p => <h2 className="text-sm font-bold text-zinc-900 mt-4 mb-2 first:mt-0" {...p} />,
          h3: p => <h3 className="text-sm font-semibold text-zinc-800 mt-3 mb-1.5 first:mt-0" {...p} />,
          h4: p => <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mt-3 mb-1.5 first:mt-0" {...p} />,
          p: p => <p className="my-2 first:mt-0 last:mb-0" {...p} />,
          ul: p => <ul className="my-2 pl-5 list-disc space-y-1 marker:text-zinc-300" {...p} />,
          ol: p => <ol className="my-2 pl-5 list-decimal space-y-1 marker:text-zinc-400" {...p} />,
          li: p => <li className="pl-0.5" {...p} />,
          a: p => <a className="text-blue-600 underline underline-offset-2 hover:text-blue-700" target="_blank" rel="noreferrer" {...p} />,
          strong: p => <strong className="font-semibold text-zinc-900" {...p} />,
          em: p => <em className="italic" {...p} />,
          hr: () => <hr className="my-4 border-zinc-200" />,
          blockquote: p => <blockquote className="my-2 pl-3 border-l-2 border-zinc-200 text-zinc-500 italic" {...p} />,
          // react-markdown gives fenced blocks a <pre><code> pair and inline spans a bare
          // <code>, so the padding belongs on <pre> — putting it here double-pads fences.
          code: p => <code className="font-mono text-[0.85em] bg-zinc-100 text-zinc-800 rounded px-1 py-0.5" {...p} />,
          pre: p => (
            <pre
              className="my-2 p-3 bg-zinc-50 border border-zinc-200 rounded-lg overflow-x-auto text-xs font-mono leading-relaxed [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-zinc-700"
              {...p}
            />
          ),
          table: p => (
            <div className="my-3 overflow-x-auto">
              <table className="w-full text-xs border-collapse" {...p} />
            </div>
          ),
          th: p => <th className="border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-left font-semibold text-zinc-700" {...p} />,
          td: p => <td className="border border-zinc-200 px-2 py-1.5 align-top" {...p} />,
          input: p => <input className="mr-1.5 align-middle accent-zinc-500" disabled {...p} />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
