import { useEffect, useState } from 'react';
import type { FileEntry } from '../../types/file';
import { formatBytes, formatFileMode } from '../../utils/formatters';
import EmptyState from '../shared/EmptyState';
import FileContextMenu from './FileContextMenu';

type Props = {
  files: FileEntry[];
  selectedPaths: Set<string>;
  isLoading: boolean;
  isError: boolean;
  onOpen: (entry: FileEntry) => void;
  onSelect: (entry: FileEntry, selected: boolean) => void;
  onDownload: (entry: FileEntry) => void;
  onDelete: (entry: FileEntry) => void;
  onCompress: (entry: FileEntry) => void;
  onDecompress: (entry: FileEntry) => void;
  onPermissions: (entry: FileEntry) => void;
};

const isArchive = (name: string) =>
  name.endsWith('.tar.gz') || name.endsWith('.tgz') || name.endsWith('.zip');

function FileList({
  files,
  selectedPaths,
  isLoading,
  isError,
  onOpen,
  onSelect,
  onDownload,
  onDelete,
  onCompress,
  onDecompress,
  onPermissions,
}: Props) {
  const [contextMenuEntry, setContextMenuEntry] = useState<FileEntry | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(
    null,
  );

  useEffect(() => {
    if (!contextMenuPosition) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenuPosition(null);
        setContextMenuEntry(null);
      }
    };
    const handleScroll = () => {
      setContextMenuPosition(null);
      setContextMenuEntry(null);
    };
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-file-context-menu="true"]')) {
        return;
      }
      setContextMenuPosition(null);
      setContextMenuEntry(null);
    };
    const handleContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-file-context-menu="true"]')) {
        return;
      }
      setContextMenuPosition(null);
      setContextMenuEntry(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('mousedown', handlePointerDown, true);
    window.addEventListener('touchstart', handlePointerDown, true);
    window.addEventListener('contextmenu', handleContextMenu, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('mousedown', handlePointerDown, true);
      window.removeEventListener('touchstart', handlePointerDown, true);
      window.removeEventListener('contextmenu', handleContextMenu, true);
    };
  }, [contextMenuPosition]);

  const closeContextMenu = () => {
    setContextMenuPosition(null);
    setContextMenuEntry(null);
  };

  if (isLoading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white px-4 py-6 text-sm text-slate-600 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500/30">
        Loading files...
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-100/60 px-4 py-6 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
        Unable to load file listing.
      </div>
    );
  }

  if (!files.length) {
    return <EmptyState title="No files here" description="Upload or create a file to get started." />;
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[620px] divide-y divide-slate-200 dark:divide-slate-800">
        <div className="grid grid-cols-[24px,1fr,96px,120px,160px,36px] gap-3 px-4 py-2 text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 dark:text-slate-500">
          <span />
          <span>Name</span>
          <span>Mode</span>
          <span>Size</span>
          <span>Modified</span>
          <span className="text-right">Actions</span>
        </div>
        {files.map((entry) => {
          const selected = selectedPaths.has(entry.path);
          return (
            <div
              key={entry.path}
              className={`grid grid-cols-[24px,1fr,96px,120px,160px,36px] items-center gap-3 px-4 py-2 text-sm ${
                selected
                  ? 'bg-primary-500/10 text-primary-600 dark:bg-primary-500/20 dark:text-primary-400'
                  : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
              onContextMenu={(event) => {
                event.preventDefault();
                setContextMenuEntry(entry);
                setContextMenuPosition({ x: event.clientX, y: event.clientY });
              }}
            >
              <input
                type="checkbox"
                checked={selected}
                onChange={(event) => onSelect(entry, event.target.checked)}
                onClick={(event) => event.stopPropagation()}
                className="h-4 w-4 rounded border-slate-300 bg-white text-primary-500 dark:border-slate-700 dark:bg-slate-900"
              />
              <button
                type="button"
                className="flex items-center gap-2 text-left text-slate-900 dark:text-slate-100"
                onClick={() => onOpen(entry)}
              >
                <span
                  className={`rounded-md px-2 py-1 text-[10px] uppercase tracking-wide ${
                    entry.isDirectory
                      ? 'bg-primary-500/10 text-primary-600 dark:bg-primary-500/20 dark:text-primary-400'
                      : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                  }`}
                >
                  {entry.isDirectory ? 'dir' : 'file'}
                </span>
                <span className="truncate">{entry.name}</span>
              </button>
              <span className="text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500">
                {formatFileMode(entry.mode)}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500">
                {entry.isDirectory ? '-' : formatBytes(entry.size)}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500">
                {entry.modified ? new Date(entry.modified).toLocaleString() : '-'}
              </span>
              <div className="flex justify-end">
                <FileContextMenu
                  entry={entry}
                  onOpen={() => onOpen(entry)}
                  onDownload={!entry.isDirectory ? () => onDownload(entry) : undefined}
                  onCompress={() => onCompress(entry)}
                  onDecompress={
                    !entry.isDirectory && isArchive(entry.name) ? () => onDecompress(entry) : undefined
                  }
                  onPermissions={() => onPermissions(entry)}
                  onDelete={() => onDelete(entry)}
                />
              </div>
            </div>
          );
        })}
      </div>
      {contextMenuEntry && contextMenuPosition ? (
        <FileContextMenu
          entry={contextMenuEntry}
          onOpen={() => onOpen(contextMenuEntry)}
          onDownload={
            !contextMenuEntry.isDirectory ? () => onDownload(contextMenuEntry) : undefined
          }
          onCompress={() => onCompress(contextMenuEntry)}
          onDecompress={
            !contextMenuEntry.isDirectory && isArchive(contextMenuEntry.name)
              ? () => onDecompress(contextMenuEntry)
              : undefined
          }
          onPermissions={() => onPermissions(contextMenuEntry)}
          onDelete={() => onDelete(contextMenuEntry)}
          contextPosition={contextMenuPosition}
          onRequestClose={closeContextMenu}
        />
      ) : null}
    </div>
  );
}

export default FileList;
