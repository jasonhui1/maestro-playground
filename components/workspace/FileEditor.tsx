'use client';

import React, { useEffect } from 'react';
import Editor from 'react-simple-code-editor';
import Prism from 'prismjs';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-yaml';
import 'prismjs/themes/prism.css';

interface FileEditorProps {
  content: string;
  onChange: (content: string) => void;
  status: 'idle' | 'saving' | 'saved' | 'error';
  error?: string | null;
}

export function FileEditor({ content, onChange, status, error }: FileEditorProps) {
  useEffect(() => {
    // Prism.highlightAll() might be needed for some cases, 
    // but react-simple-code-editor uses the highlight prop.
  }, [content]);

  const highlight = (code: string) => {
    // We use markdown as the base language for .md files which often contain YAML frontmatter
    return Prism.highlight(code, Prism.languages.markdown, 'markdown');
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-2 px-1 h-8">
        <div className="flex items-center gap-3">
          {status === 'saving' && (
            <span className="text-xs font-medium text-blue-600 animate-pulse flex items-center gap-1.5 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100">
              <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
              Saving...
            </span>
          )}
          {status === 'saved' && (
            <span className="text-xs font-medium text-green-700 flex items-center gap-1.5 bg-green-50 px-2 py-0.5 rounded-full border border-green-100">
              <span className="w-2 h-2 bg-green-500 rounded-full"></span>
              Saved
            </span>
          )}
          {status === 'error' && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-red-700 flex items-center gap-1.5 bg-red-50 px-2 py-0.5 rounded-full border border-red-100">
                <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                Error
              </span>
              {error && (
                <span className="text-xs text-red-500 font-mono truncate max-w-[400px]" title={error}>
                  {error}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      
      <div className="flex-1 border border-zinc-200 rounded-lg overflow-hidden bg-white font-mono text-sm shadow-sm">
        <Editor
          value={content}
          onValueChange={onChange}
          highlight={highlight}
          padding={20}
          className="min-h-[500px] focus:outline-none"
          style={{
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            fontSize: 14,
          }}
        />
      </div>
    </div>
  );
}
