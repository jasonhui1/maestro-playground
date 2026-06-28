'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import matter from 'gray-matter';

interface FileEditorProps {
  content: string;
  onChange: (content: string) => void;
  status: 'idle' | 'saving' | 'saved' | 'error';
  error?: string | null;
  language?: string;
  type?: string | null;
}

export function FileEditor({ content, onChange, status, error, language = 'markdown', type }: FileEditorProps) {
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);

  const handleEditorChange = (value: string | undefined) => {
    if (value !== undefined) {
      onChange(value);
    }
  };

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    // Initial validation
    validate(content);
  };

  const validate = useCallback((value: string) => {
    if (!monacoRef.current || !editorRef.current) return;

    const errors: string[] = [];
    const model = editorRef.current.getModel();
    if (!model) return;

    try {
      if (language === 'markdown') {
        const { data } = matter(value);
        
        // Type-specific validation
        if (type === 'agent') {
          if (!data.name) errors.push("Missing required field: 'name'");
          if (!data.model) errors.push("Missing required field: 'model'");
        } else if (type === 'skill') {
          if (!data.name) errors.push("Missing required field: 'name'");
        } else if (type === 'chain') {
          if (!data.name) errors.push("Missing required field: 'name'");
          if (!Array.isArray(data.nodes)) errors.push("Missing or invalid field: 'nodes' (must be an array)");
          if (!Array.isArray(data.edges)) errors.push("Missing or invalid field: 'edges' (must be an array)");
        } else if (type === 'template') {
          if (!data.name) errors.push("Missing required field: 'name'");
          if (!data.chain) errors.push("Missing required field: 'chain'");
        }
      } else if (language === 'yaml') {
        matter(`---\n${value}\n---`);
      }

      // Clear markers if YAML is valid (even if there are logical errors)
      monacoRef.current.editor.setModelMarkers(model, 'validation', []);
      setValidationErrors(errors);
      
      // If we have logical errors, add markers for them on the first line
      if (errors.length > 0) {
        monacoRef.current.editor.setModelMarkers(model, 'validation', errors.map(msg => ({
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: 1,
          endColumn: 1000,
          message: msg,
          severity: monacoRef.current!.MarkerSeverity.Error,
        })));
      }
    } catch (err: unknown) {
      const yamlError = err as { reason?: string; message?: string; mark?: { line: number; column: number } };
      const message = yamlError.reason || yamlError.message || "Invalid YAML frontmatter";
      errors.push(message);
      setValidationErrors(errors);

      let line = 1;
      let column = 1;
      
      // js-yaml (used by gray-matter) provides mark info
      if (yamlError.mark) {
        line = yamlError.mark.line + 1;
        column = yamlError.mark.column + 1;
      }

      monacoRef.current.editor.setModelMarkers(model, 'validation', [
        {
          startLineNumber: line,
          startColumn: column,
          endLineNumber: line,
          endColumn: 1000,
          message: message,
          severity: monacoRef.current.MarkerSeverity.Error,
        },
      ]);
    }
  }, [language, type]);

  useEffect(() => {
    const timer = setTimeout(() => {
      validate(content);
    }, 500);
    return () => clearTimeout(timer);
  }, [content, validate]);

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
          
          <div className="h-4 w-px bg-zinc-200 mx-1"></div>
          
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium flex items-center gap-1.5 px-2 py-0.5 rounded-full border ${
              validationErrors.length === 0 
                ? 'text-green-700 bg-green-50 border-green-100' 
                : 'text-amber-700 bg-amber-50 border-amber-100'
            }`}>
              <span className={`w-2 h-2 rounded-full ${
                validationErrors.length === 0 ? 'bg-green-500' : 'bg-amber-500'
              }`}></span>
              {validationErrors.length === 0 ? 'Valid' : `${validationErrors.length} Validation ${validationErrors.length === 1 ? 'Error' : 'Errors'}`}
            </span>
            {validationErrors.length > 0 && (
              <span className="text-[10px] text-amber-600 font-medium truncate max-w-[300px]">
                {validationErrors[0]}
              </span>
            )}
          </div>
        </div>
      </div>
      
      <div className="flex-1 border border-zinc-200 rounded-lg overflow-hidden bg-white shadow-sm">
        <Editor
          height="100%"
          language={language}
          value={content}
          onChange={handleEditorChange}
          onMount={handleEditorDidMount}
          theme="vs-light"
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            wordWrap: 'on',
            padding: { top: 16, bottom: 16 },
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          }}
        />
      </div>
    </div>
  );
}
