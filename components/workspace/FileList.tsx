'use client';

import { ChevronDown, ChevronRight, Folder, FolderOpen, Plus, Star, Trash2 } from 'lucide-react';
import type { Row, TreeItem } from '@/lib/fileTree';
import { FAVORITES_PATH } from '@/lib/fileTree';

interface FileListProps {
  rows: Row[];
  activeSlug: string | null;
  activeType: string | null;
  onSelect: (item: TreeItem) => void;
  onToggleFolder: (key: string, expanded: boolean) => void;
  onToggleFavorite: (e: React.MouseEvent, item: TreeItem) => void;
  onDelete: (e: React.MouseEvent, item: TreeItem) => void;
  onCreateInFolder: (e: React.MouseEvent, folderPath: string) => void;
  emptyLabel: string;
}

// The column is narrow, so one level costs 12px and a hairline guide carries the rest.
const INDENT = 12;

function Guide({ depth }: { depth: number }) {
  if (depth === 0) return null;
  return (
    <div
      className="absolute top-0 bottom-0 w-px bg-zinc-100"
      style={{ left: 8 + (depth - 1) * INDENT + 6 }}
    />
  );
}

export default function FileList({
  rows,
  activeSlug,
  activeType,
  onSelect,
  onToggleFolder,
  onToggleFavorite,
  onDelete,
  onCreateInFolder,
  emptyLabel,
}: FileListProps) {
  const isActive = (item: TreeItem) => activeType === item.entityType && activeSlug === item.slug;

  if (rows.length === 0) {
    return <p className="px-3 py-2 text-xs text-zinc-400 italic">{emptyLabel}</p>;
  }

  return (
    <ul className="space-y-0.5">
      {rows.map((row) =>
        row.kind === 'folder' ? (
          <li key={row.key} className="group relative">
            <button
              onClick={() => onToggleFolder(row.key, row.expanded)}
              aria-expanded={row.expanded}
              className="w-full text-left px-2 py-1.5 text-sm rounded-md flex items-center gap-1.5 text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 transition-colors pr-8"
              style={{ paddingLeft: 8 + row.depth * INDENT }}
            >
              <Guide depth={row.depth} />
              {row.expanded ? <ChevronDown size={13} className="shrink-0 text-zinc-400" /> : <ChevronRight size={13} className="shrink-0 text-zinc-400" />}
              {row.path === FAVORITES_PATH ? (
                <Star size={13} className="shrink-0 fill-current text-yellow-500" />
              ) : row.expanded ? (
                <FolderOpen size={13} className="shrink-0 text-zinc-400" />
              ) : (
                <Folder size={13} className="shrink-0 text-zinc-400" />
              )}
              <span className="truncate font-medium">{row.label}</span>
            </button>
            {row.path !== FAVORITES_PATH && (
              <button
                onClick={(e) => onCreateInFolder(e, row.path)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-300 opacity-0 group-hover:opacity-100 hover:text-zinc-600 transition-opacity"
                title="New file in this folder"
              >
                <Plus size={14} />
              </button>
            )}
          </li>
        ) : (
          <li key={row.key} className="group relative">
            <button
              onClick={() => onSelect(row.item)}
              className={`w-full text-left px-3 py-1.5 text-sm rounded-md transition-all pr-14 flex items-center gap-2 ${
                isActive(row.item)
                  ? 'bg-zinc-100/80 text-zinc-900 font-medium'
                  : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900'
              }`}
              style={{ paddingLeft: 12 + row.depth * INDENT }}
            >
              {isActive(row.item) && (
                <div className="absolute left-0 top-1.5 bottom-1.5 w-1 bg-indigo-500 rounded-full" />
              )}
              <Guide depth={row.depth} />
              <span className="truncate block flex-1">
                {row.label}
                {row.subtitle && (
                  <span className="ml-1.5 text-[11px] text-zinc-400 font-normal">{row.subtitle}</span>
                )}
              </span>
            </button>
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
              <button
                onClick={(e) => onToggleFavorite(e, row.item)}
                className={`transition-opacity ${
                  row.isFavorite
                    ? 'text-yellow-500 opacity-100'
                    : 'text-zinc-300 opacity-0 group-hover:opacity-100 hover:text-yellow-500'
                }`}
                title={row.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              >
                <Star size={14} className={row.isFavorite ? 'fill-current' : ''} />
              </button>
              <button
                onClick={(e) => onDelete(e, row.item)}
                className="text-zinc-300 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-opacity"
                title="Delete"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </li>
        ),
      )}
    </ul>
  );
}
