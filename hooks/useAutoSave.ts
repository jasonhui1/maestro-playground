'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import matter from 'gray-matter';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function useAutoSave(type: string | null, slug: string | null, initialContent: string) {
  const [content, setContent] = useState(initialContent);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Update content when initialContent changes (e.g., when switching files)
  useEffect(() => {
    setContent(initialContent);
    setStatus('idle');
    setError(null);
  }, [initialContent]);

  const save = useCallback(async (currentContent: string) => {
    if (!type || !slug) return;

    setStatus('saving');
    setError(null);

    try {
      // Parse the content into frontmatter and body
      const { data, content: body } = matter(currentContent);

      const response = await fetch(`/api/workspace/${type}/${slug}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ data, content: body }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save');
      }

      setStatus('saved');
    } catch (err: any) {
      console.error('Auto-save error:', err);
      setStatus('error');
      setError(err.message);
    }
  }, [type, slug]);

  useEffect(() => {
    // Don't trigger save on initial load or if content hasn't changed from initialContent
    if (content === initialContent) return;

    // Clear existing timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    // Set new timer for 2 seconds
    timerRef.current = setTimeout(() => {
      save(content);
    }, 2000);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [content, initialContent, save]);

  return {
    content,
    setContent,
    status,
    error,
  };
}
