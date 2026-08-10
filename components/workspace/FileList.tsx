'use client';

import { useEffect, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { ChevronDown, ChevronRight, Folder, FolderOpen, FolderPlus, Plus, Star, Trash2 } from 'lucide-react';
import type { FileRow, FolderRow, Row, TreeItem } from '@/lib/fileTree';
import { FAVORITES_PATH, ROOT_DROP_ID, resolveDropFolder } from '@/lib/fileTree';
import ContextMenu, { type ContextMenuItem } from './ContextMenu';

interface FileListProps {
  rows: Row[];
  activeSlug: string | null;
  activeType: string | null;
  /** Every folder under the active type a file could move to (#53), root excluded. */
  folders: string[];
  /** Off while a search query is active — the flattened list has no folder to drop onto (#56). */
  dragDisabled: boolean;
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

type EditingFolder = { path: string; value: string; error: string | null } | null;

// The column is narrow, so one level costs 12px and a hairline guide carries the rest.
const INDENT = 12;

const FOLDER_RENAME_TOOLTIP = "A folder isn't a reference — renaming it doesn't touch any file, chain, or version history.";

function Guide({ depth }: { depth: number }) {
  if (depth === 0) return null;
  return (
    <div
      className="absolute top-0 bottom-0 w-px bg-zinc-100"
      style={{ left: 8 + (depth - 1) * INDENT + 6 }}
    />
  );
}

interface FolderRowItemProps {
  row: FolderRow;
  editingFolder: EditingFolder;
  setEditingFolder: (v: EditingFolder) => void;
  commitFolderRename: () => void;
  dragDisabled: boolean;
  onToggleFolder: (key: string, expanded: boolean) => void;
  onCreateInFolder: (e: React.MouseEvent, folderPath: string) => void;
  onCreateFolderInFolder: (e: React.MouseEvent, folderPath: string) => void;
  onContextMenu: (e: React.MouseEvent, path: string, label: string) => void;
}

function FolderRowItem({
  row,
  editingFolder,
  setEditingFolder,
  commitFolderRename,
  dragDisabled,
  onToggleFolder,
  onCreateInFolder,
  onCreateFolderInFolder,
  onContextMenu,
}: FolderRowItemProps) {
  const isFavorites = row.path === FAVORITES_PATH;
  const dropDisabled = isFavorites || dragDisabled;
  const { setNodeRef, isOver } = useDroppable({
    id: row.key,
    data: { folderPath: row.path },
    disabled: dropDisabled,
  });

  // A folder dwelled over mid-drag expands on its own, so a drop into a nested folder
  // takes one drag instead of an expand-then-drag (#56).
  useEffect(() => {
    if (!isOver || row.expanded || dropDisabled) return;
    const timer = setTimeout(() => onToggleFolder(row.key, row.expanded), 600);
    return () => clearTimeout(timer);
  }, [isOver, row.expanded, row.key, dropDisabled, onToggleFolder]);

  const isEditing = editingFolder?.path === row.path;

  return (
    <li
      ref={setNodeRef}
      className={`group relative rounded-md transition-colors ${
        isOver && !dropDisabled ? 'bg-indigo-50 ring-1 ring-inset ring-indigo-300' : ''
      }`}
      onContextMenu={!isFavorites ? (e) => onContextMenu(e, row.path, row.label) : undefined}
    >
      {isEditing ? (
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
            title={FOLDER_RENAME_TOOLTIP}
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
      {isEditing && editingFolder.error && (
        <p
          className="text-xs text-red-600 pb-1"
          style={{ paddingLeft: 8 + row.depth * INDENT + 20 }}
        >
          {editingFolder.error}
        </p>
      )}
    </li>
  );
}

interface FileRowItemProps {
  row: FileRow;
  isActive: boolean;
  dragDisabled: boolean;
  onSelect: (item: TreeItem) => void;
  onToggleFavorite: (e: React.MouseEvent, item: TreeItem) => void;
  onDelete: (e: React.MouseEvent, item: TreeItem) => void;
  onContextMenu: (e: React.MouseEvent, item: TreeItem) => void;
}

function FileRowItem({ row, isActive, dragDisabled, onSelect, onToggleFavorite, onDelete, onContextMenu }: FileRowItemProps) {
  // The pinned Favorites node is a view, not a location — dragging out of it has no meaning (#56).
  const disabled = dragDisabled || row.inFavorites;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: row.key,
    data: { item: row.item },
    disabled,
  });

  return (
    <li className="group relative" onContextMenu={(e) => onContextMenu(e, row.item)}>
      <button
        ref={setNodeRef}
        onClick={() => onSelect(row.item)}
        style={{ paddingLeft: 12 + row.depth * INDENT, opacity: isDragging ? 0.4 : 1 }}
        className={`w-full text-left px-3 py-1.5 text-sm rounded-md transition-all pr-14 flex items-center gap-2 ${
          isActive
            ? 'bg-zinc-100/80 text-zinc-900 font-medium'
            : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900'
        }`}
        {...(disabled ? {} : attributes)}
        {...(disabled ? {} : listeners)}
      >
        {isActive && (
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
  );
}

// A dedicated area below the tree, so a file dragged out of any folder has somewhere to
// land that means "root" without having to be dropped precisely on empty space (#56).
function RootDropZone({ dragDisabled }: { dragDisabled: boolean }) {
  const { setNodeRef, isOver, active } = useDroppable({ id: ROOT_DROP_ID, disabled: dragDisabled });
  if (dragDisabled || !active) return null;
  return (
    <div
      ref={setNodeRef}
      className={`mt-1 rounded-md border border-dashed text-center text-[11px] py-3 transition-colors ${
        isOver ? 'border-indigo-400 bg-indigo-50 text-indigo-600' : 'border-zinc-200 text-zinc-400'
      }`}
    >
      Drop here to move to root
    </div>
  );
}

export default function FileList({
  rows,
  activeSlug,
  activeType,
  folders,
  dragDisabled,
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
  const [editingFolder, setEditingFolder] = useState<EditingFolder>(null);
  const [draggedItem, setDraggedItem] = useState<TreeItem | null>(null);

  // A short move threshold, so a plain click to select a file still fires as a click.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

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
      title: FOLDER_RENAME_TOOLTIP,
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

  const handleDragStart = (event: DragStartEvent) => {
    setDraggedItem((event.active.data.current?.item as TreeItem | undefined) ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDraggedItem(null);
    const { active, over } = event;
    if (!over) return;
    const item = active.data.current?.item as TreeItem | undefined;
    if (!item) return;
    const folder = resolveDropFolder(String(over.id), over.data.current?.folderPath as string | undefined);
    if (folder === undefined) return;
    onMove(item, folder);
  };

  if (rows.length === 0) {
    return <p className="px-3 py-2 text-xs text-zinc-400 italic">{emptyLabel}</p>;
  }

  return (
    <>
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <ul className="space-y-0.5">
        {rows.map((row) =>
          row.kind === 'folder' ? (
            <FolderRowItem
              key={row.key}
              row={row}
              editingFolder={editingFolder}
              setEditingFolder={setEditingFolder}
              commitFolderRename={commitFolderRename}
              dragDisabled={dragDisabled}
              onToggleFolder={onToggleFolder}
              onCreateInFolder={onCreateInFolder}
              onCreateFolderInFolder={onCreateFolderInFolder}
              onContextMenu={openFolderContextMenu}
            />
          ) : (
            <FileRowItem
              key={row.key}
              row={row}
              isActive={isActive(row.item)}
              dragDisabled={dragDisabled}
              onSelect={onSelect}
              onToggleFavorite={onToggleFavorite}
              onDelete={onDelete}
              onContextMenu={openContextMenu}
            />
          ),
        )}
      </ul>
      <RootDropZone dragDisabled={dragDisabled} />
      <DragOverlay>
        {draggedItem ? (
          <div className="px-3 py-1.5 text-sm bg-white border border-zinc-300 rounded-md shadow-lg text-zinc-700">
            {draggedItem.name}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
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
