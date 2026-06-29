'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import matter from 'gray-matter';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function useAutoSave(type: string | null, slug: string | null, initialContent: string) {
  const [content, setContent] = useState(initialContent);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const lastSavedContentRef = useRef(initialContent);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Update content when initialContent changes (e.g., when switching files)
  useEffect(() => {
    setContent(initialContent);
    lastSavedContentRef.current = initialContent;
    setStatus('idle');
    setError(null);
    setIsDirty(false);
  }, [initialContent]);

  // Warn user before leaving if there are unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  const save = useCallback(async (currentContent: string) => {
    if (!type || !slug) return;

    setStatus('saving');
    setError(null);

    try {
      // Parse the content into frontmatter and body
      let data, body;
      try {
        const parsed = matter(currentContent);
        data = parsed.data;
        body = parsed.content;
      } catch {
        // If YAML is invalid, don't trigger a server save, but don't show a hard error either
        // The FileEditor will show the validation error
        setStatus('idle');
        return;
      }

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

      lastSavedContentRef.current = currentContent;
      setStatus('saved');
      setIsDirty(false);
    } catch (err: unknown) {
      console.error('Auto-save error:', err);
      setStatus('error');
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    }
  }, [type, slug]);

  const flush = useCallback(async (override?: string) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const target = override ?? content;
    if (target !== lastSavedContentRef.current) {
      await save(target);
    }
  }, [content, save]);

  useEffect(() => {
    const dirty = content !== lastSavedContentRef.current;
    setIsDirty(dirty);

    // Don't trigger save if not dirty
    if (!dirty) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      return;
    }

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
  }, [content, save]);

  return {
    content,
    setContent,
    status,
    error,
    isDirty,
    flush,
    getLastSaved: () => lastSavedContentRef.current,
  };
}
