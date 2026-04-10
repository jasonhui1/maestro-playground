'use client';

import React from 'react';

/**
 * WorkspaceSkeleton
 * 
 * A Tailwind-based skeleton component that mimics the layout of the Workspace content area,
 * including the toolbar, status bar, and main editor/flow area.
 * 
 * Used to provide visual continuity during content fetches and reduce flicker.
 */
export function WorkspaceSkeleton() {
  return (
    <div className="flex flex-col h-full w-full animate-pulse bg-white">
      {/* Toolbar Placeholder (h-14) 
          Mimics the stable toolbar in app/workspace/page.tsx */}
      <div className="px-6 py-3 border-b border-zinc-100 flex items-center justify-between bg-white/80 backdrop-blur-sm">
        <div className="flex items-center gap-4">
          {/* Title Accent */}
          <div className="h-8 w-1 bg-zinc-200 rounded-full mr-1" />
          <div className="space-y-2">
            {/* Type Label Placeholder */}
            <div className="h-2 w-16 bg-zinc-100 rounded"></div>
            {/* Slug Title Placeholder */}
            <div className="h-4 w-32 bg-zinc-200 rounded"></div>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {/* View Mode Toggle Placeholder (for Chains) */}
          <div className="h-8 w-24 bg-zinc-100 rounded-lg mr-2"></div>
          {/* Run Button Placeholder */}
          <div className="h-8 w-20 bg-zinc-200 rounded-md shadow-sm"></div>
          {/* Output Toggle Placeholder */}
          <div className="h-8 w-8 bg-zinc-100 rounded-md border border-zinc-200"></div>
        </div>
      </div>

      {/* Main Content Area Wrapper
          Mimics the padding in app/workspace/page.tsx (p-6 pt-4) */}
      <div className="flex-1 p-6 pt-4 flex flex-col min-h-0">
        
        {/* Status Bar Placeholder (h-8)
            Mimics the status bar in FileEditor.tsx */}
        <div className="flex items-center justify-between mb-2 px-1 h-8">
          <div className="flex items-center gap-3">
            {/* Status Pill (Saving/Saved/Error) */}
            <div className="h-5 w-24 bg-zinc-100 rounded-full border border-zinc-200/50"></div>
            
            {/* Separator */}
            <div className="h-4 w-px bg-zinc-100 mx-1"></div>
            
            {/* Validation Pill (Valid/Invalid) */}
            <div className="h-5 w-32 bg-zinc-100 rounded-full border border-zinc-200/50"></div>
          </div>
        </div>

        {/* Editor / Flow Canvas Placeholder
            Mimics the main content container with border and shadow */}
        <div className="flex-1 border border-zinc-200 rounded-lg overflow-hidden bg-white shadow-sm flex flex-col">
          {/* Simulated Content (Lines of code or node-like structures) */}
          <div className="p-6 space-y-4 overflow-hidden">
            {/* Top-level lines */}
            <div className="h-4 w-[85%] bg-zinc-50 rounded"></div>
            <div className="h-4 w-[60%] bg-zinc-50 rounded"></div>
            <div className="h-4 w-[75%] bg-zinc-50 rounded"></div>
            <div className="h-4 w-[40%] bg-zinc-50 rounded"></div>
            
            {/* Indented block (mimicking YAML or code structure) */}
            <div className="pl-6 space-y-4 pt-2">
              <div className="h-4 w-[70%] bg-zinc-50 rounded"></div>
              <div className="h-4 w-[50%] bg-zinc-50 rounded"></div>
              <div className="h-4 w-[80%] bg-zinc-50 rounded"></div>
            </div>
            
            {/* Another block */}
            <div className="pt-4 space-y-4">
              <div className="h-4 w-[30%] bg-zinc-50 rounded"></div>
              <div className="h-4 w-[65%] bg-zinc-50 rounded"></div>
              <div className="h-4 w-[45%] bg-zinc-50 rounded"></div>
            </div>

            {/* Bottom lines */}
            <div className="pt-6 space-y-4">
              <div className="h-4 w-[90%] bg-zinc-50 rounded"></div>
              <div className="h-4 w-[55%] bg-zinc-50 rounded"></div>
              <div className="h-4 w-[70%] bg-zinc-50 rounded"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
