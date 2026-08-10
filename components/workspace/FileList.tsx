'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Folder, FolderOpen, FolderPlus, Plus, Star, Trash2 } from 'lucide-react';
import type { Row, TreeItem } from '@/lib/fileTree';
import { FAVORITES_PATH } from '@/lib/fileTree';
import ContextMenu, { type ContextMenuItem } from './ContextMenu';

interface FileListProps {
  rows: Row[];
  activeSlug: string | null;
  activeType: string | null;
  /** Every folder under the active type a file could move to (#53), root excluded. */
  folders: string[];
  onSelect: (item: TreeItem) => void;
  onToggleFolder: (key: string, expanded: boolean) => void;
  onToggleFavorite: (e: React.MouseEvent, item: TreeItem) => void;
  onDelete: (e: React.MouseEvent, item: TreeItem) => void;
  onMove: (item: TreeItem, folder: string) => void;
  onRename: (item: TreeItem) => void;
  onCreateInFolder: (e: React.MouseEvent, folderPath: string) => void;
  onCreateFolderInFolder: (e: React.MouseEvent, folderPath: string) => void;
  /** Renames a folder's leaf segment. Resolves an inline error message, or null on success (#55). */
  onRenameFolder: (folderPath: string, name: string) => Promise<string | null>;
  onDeleteFolder: (folderPath: string) => void;
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
  folders,
  onSelect,
  onToggleFolder,
  onToggleFavorite,
  onDelete,
  onMove,
  onRename,
  onCreateInFolder,
  onCreateFolderInFolder,
  onRenameFolder,
  onDeleteFolder,
  emptyLabel,
}: FileListProps) {
  const isActive = (item: TreeItem) => activeType === item.entityType && activeSlug === item.slug;
  const [contextMenu, setContextMenu] = useState<
    | { kind: 'file'; item: TreeItem; x: number; y: number }
    | { kind: 'folder'; path: string; label: string; x: number; y: number }
    | null
  >(null);
  const [editingFolder, setEditingFolder] = useState<{ path: string; value: string; error: string | null } | null>(null);

  const openContextMenu = (e: React.MouseEvent, item: TreeItem) => {
    e.preventDefault();
    setContextMenu({ kind: 'file', item, x: e.clientX, y: e.clientY });
  };

  const openFolderContextMenu = (e: React.MouseEvent, path: string, label: string) => {
    e.preventDefault();
    setContextMenu({ kind: 'folder', path, label, x: e.clientX, y: e.clientY });
  };

  const rowMenuItems = (item: TreeItem): ContextMenuItem[] => [
    {
      key: 'move',
      label: 'Move to…',
      submenu: [
        { key: 'root', label: '/ (root)', onClick: () => onMove(item, '') },
        ...folders.map((folder) => ({ key: folder, label: folder, onClick: () => onMove(item, folder) })),
      ],
    },
    { key: 'rename', label: 'Rename…', onClick: () => onRename(item) },
  ];

  const folderMenuItems = (path: string, label: string): ContextMenuItem[] => [
    {
      key: 'rename',
      label: 'Rename…',
      title: "A folder isn't a reference — renaming it doesn't touch any file, chain, or version history.",
      onClick: () => setEditingFolder({ path, value: label, error: null }),
    },
    { key: 'delete', label: 'Delete', onClick: () => onDeleteFolder(path) },
  ];

  const commitFolderRename = async () => {
    if (!editingFolder) return;
    const { path, value } = editingFolder;
    if (!value.trim()) {
      setEditingFolder(null);
      return;
    }
    const error = await onRenameFolder(path, value.trim());
    if (error) {
      setEditingFolder({ path, value, error });
    } else {
      setEditingFolder(null);
    }
  };

  if (rows.length === 0) {
    return <p className="px-3 py-2 text-xs text-zinc-400 italic">{emptyLabel}</p>;
  }

  return (
    <>
    <ul className="space-y-0.5">
      {rows.map((row) =>
        row.kind === 'folder' ? (
          <li
            key={row.key}
            className="group relative"
            onContextMenu={row.path !== FAVORITES_PATH ? (e) => openFolderContextMenu(e, row.path, row.label) : undefined}
          >
            {editingFolder?.path === row.path ? (
              <div
                className="flex items-center gap-1.5 py-1.5"
                style={{ paddingLeft: 8 + row.depth * INDENT }}
              >
                <Guide depth={row.depth} />
                {row.expanded ? <ChevronDown size={13} className="shrink-0 text-zinc-400" /> : <ChevronRight size={13} className="shrink-0 text-zinc-400" />}
                <Folder size={13} className="shrink-0 text-zinc-400" />
                <input
                  autoFocus
                  value={editingFolder.value}
                  onChange={(e) => setEditingFolder({ path: row.path, value: e.target.value, error: null })}
                  onBlur={commitFolderRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitFolderRename();
                    if (e.key === 'Escape') setEditingFolder(null);
                  }}
                  title="A folder isn't a reference — renaming it doesn't touch any file, chain, or version history."
                  className="min-w-0 flex-1 px-1 py-0 text-sm border border-zinc-300 rounded focus:outline-none focus:ring-1 focus:ring-zinc-500"
                />
              </div>
            ) : (
              <>
                <button
                  onClick={() => onToggleFolder(row.key, row.expanded)}
                  aria-expanded={row.expanded}
                  className="w-full text-left px-2 py-1.5 text-sm rounded-md flex items-center gap-1.5 text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 transition-colors pr-14"
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
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    <button
                      onClick={(e) => onCreateFolderInFolder(e, row.path)}
                      className="text-zinc-300 opacity-0 group-hover:opacity-100 hover:text-zinc-600 transition-opacity"
                      title="New folder in this folder"
                    >
                      <FolderPlus size={14} />
                    </button>
                    <button
                      onClick={(e) => onCreateInFolder(e, row.path)}
                      className="text-zinc-300 opacity-0 group-hover:opacity-100 hover:text-zinc-600 transition-opacity"
                      title="New file in this folder"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                )}
              </>
            )}
            {editingFolder?.path === row.path && editingFolder.error && (
              <p
                className="text-xs text-red-600 pb-1"
                style={{ paddingLeft: 8 + row.depth * INDENT + 20 }}
              >
                {editingFolder.error}
              </p>
            )}
          </li>
        ) : (
          <li key={row.key} className="group relative" onContextMenu={(e) => openContextMenu(e, row.item)}>
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
    {contextMenu && (
      <ContextMenu
        x={contextMenu.x}
        y={contextMenu.y}
        items={
          contextMenu.kind === 'file'
            ? rowMenuItems(contextMenu.item)
            : folderMenuItems(contextMenu.path, contextMenu.label)
        }
        onClose={() => setContextMenu(null)}
      />
    )}
    </>
  );
}
