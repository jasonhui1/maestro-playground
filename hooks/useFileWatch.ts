'use client'
import { useEffect, useState } from 'react'

// Subscribe to on-disk changes for an entity; returns the latest raw file content (or null).
export function useFileWatch(type: string | null, slug: string | null): string | null {
  const [incoming, setIncoming] = useState<string | null>(null)
  useEffect(() => {
    if (!type || !slug) return
    const es = new EventSource(`/api/watch?type=${type}&slug=${slug}`)
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.type === 'change' && typeof data.raw === 'string') setIncoming(data.raw)
      } catch {}
    }
    return () => es.close()
  }, [type, slug])
  return incoming
}
