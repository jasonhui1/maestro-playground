'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { FileEditor } from '@/components/workspace/FileEditor';
import { useAutoSave } from '@/hooks/useAutoSave';

function WorkspaceContent() {
  const searchParams = useSearchParams();
  const type = searchParams.get('type');
  const slug = searchParams.get('slug');
  const [initialContent, setInitialContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const { content, setContent, status, error: saveError } = useAutoSave(type, slug, initialContent);

  useEffect(() => {
    if (!type || !slug) {
      setInitialContent('');
      return;
    }

    async function fetchContent() {
      setLoading(true);
      setFetchError(null);
      try {
        const response = await fetch(`/api/workspace/${type}/${slug}`);
        if (!response.ok) {
          throw new Error('Failed to fetch file content');
        }
        const data = await response.json();
        setInitialContent(data.raw || '');
      } catch (err: any) {
        setFetchError(err.message);
      } finally {
        setLoading(false);
      }
    }

    fetchContent();
  }, [type, slug]);

  if (!type || !slug) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-zinc-500">
        <div className="mb-4 text-4xl">📄</div>
        <p className="text-lg">Select a file from the sidebar to start editing</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-8 flex flex-col items-center justify-center h-full text-zinc-500">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-zinc-300 mb-4"></div>
        <p>Loading file content...</p>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="p-8 text-red-500">
        <h2 className="text-xl font-bold mb-2">Error</h2>
        <p>{fetchError}</p>
      </div>
    );
  }

  return (
    <div className="p-8 h-full flex flex-col">
      <div className="mb-6">
        <div className="flex items-center gap-2 text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">
          <span>{type}</span>
          <span>/</span>
          <span>{slug}</span>
        </div>
        <h1 className="text-2xl font-bold text-zinc-900 capitalize">
          {slug.replace(/-/g, ' ')}
        </h1>
      </div>
      
      <div className="flex-1 min-h-0">
        <FileEditor 
          content={content} 
          onChange={setContent} 
          status={status} 
          error={saveError} 
        />
      </div>
    </div>
  );
}

export default function WorkspacePage() {
  return (
    <Suspense fallback={<div className="p-8">Loading content...</div>}>
      <WorkspaceContent />
    </Suspense>
  );
}
