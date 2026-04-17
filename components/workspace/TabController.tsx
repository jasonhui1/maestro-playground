'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { parseTabs, serializeTabs } from '@/lib/fs/tabs';
import { WorkspaceTab } from '@/lib/types';
import { X } from 'lucide-react';

export function TabController() {
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const activeType = searchParams.get('type');
  const activeSlug = searchParams.get('slug');
  const tabsParam = searchParams.get('tabs');

  const tabs = useMemo(() => {
    return parseTabs(tabsParam, activeType, activeSlug);
  }, [tabsParam, activeType, activeSlug]);

  const handleTabClick = (tab: WorkspaceTab) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('type', tab.type);
    params.set('slug', tab.slug);
    router.push(`/workspace?${params.toString()}`);
  };

  const handleCloseTab = (e: React.MouseEvent, tabToClose: WorkspaceTab) => {
    e.stopPropagation();
    
    const closedIndex = tabs.findIndex(
      t => t.type === tabToClose.type && t.slug === tabToClose.slug
    );
    
    const newTabs = tabs.filter(
      t => !(t.type === tabToClose.type && t.slug === tabToClose.slug)
    );
    
    const params = new URLSearchParams(searchParams.toString());
    
    if (newTabs.length === 0) {
      params.delete('type');
      params.delete('slug');
      params.delete('tabs');
    } else {
      params.set('tabs', serializeTabs(newTabs));
      
      // If we closed the active tab, switch to the adjacent tab
      if (tabToClose.active) {
        const nextTabIndex = Math.max(0, closedIndex - 1);
        const nextTab = newTabs[nextTabIndex];
        params.set('type', nextTab.type);
        params.set('slug', nextTab.slug);
      }
    }
    
    router.push(`/workspace?${params.toString()}`);
  };

  if (tabs.length === 0) return null;

  return (
    <div className="flex items-center bg-zinc-50 border-b border-zinc-200 overflow-x-auto h-10">
      {tabs.map((tab) => (
        <div
          key={`${tab.type}:${tab.slug}`}
          onClick={() => handleTabClick(tab)}
          onMouseDown={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              handleCloseTab(e, tab);
            }
          }}
          title={tab.slug}
          role="tab"
          aria-selected={tab.active}
          className={`flex items-center h-full px-4 border-r border-zinc-200 cursor-pointer transition-colors min-w-[120px] max-w-[200px] group ${
            tab.active 
              ? 'bg-white text-zinc-900 border-b-2 border-b-zinc-900 -mb-[1px]' 
              : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700'
          }`}
        >
          <span className="text-xs font-medium truncate flex-1">
            {tab.slug.replace(/-/g, ' ')}
          </span>
          <button
            onClick={(e) => handleCloseTab(e, tab)}
            className={`ml-2 p-0.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-zinc-200 transition-all ${
              tab.active ? 'opacity-100' : ''
            }`}
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
