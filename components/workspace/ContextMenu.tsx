'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';

export interface ContextMenuItem {
  key: string;
  label: string;
  title?: string;
  onClick?: () => void;
  submenu?: ContextMenuItem[];
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

// Reusable row context menu (#53) — later rows (rename, duplicate, delete) extend `items`,
// not this component.
export default function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[180px] bg-white border border-zinc-200 rounded-md shadow-lg py-1"
      style={{ left: x, top: y }}
    >
      {items.map((item) => (
        <div key={item.key} className="relative">
          <button
            onClick={() => {
              if (item.submenu) {
                setOpenSubmenu(openSubmenu === item.key ? null : item.key);
              } else {
                item.onClick?.();
                onClose();
              }
            }}
            title={item.title}
            className="w-full text-left px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 flex items-center justify-between gap-4"
          >
            <span>{item.label}</span>
            {item.submenu && <ChevronRight size={12} className="text-zinc-400 shrink-0" />}
          </button>
          {item.submenu && openSubmenu === item.key && (
            <div className="absolute left-full top-0 min-w-[160px] max-h-64 overflow-y-auto bg-white border border-zinc-200 rounded-md shadow-lg py-1">
              {item.submenu.map((sub) => (
                <button
                  key={sub.key}
                  onClick={() => {
                    sub.onClick?.();
                    onClose();
                  }}
                  className="w-full text-left px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 truncate"
                >
                  {sub.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
