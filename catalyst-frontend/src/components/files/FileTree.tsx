import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { filesApi } from '../../services/api/files';
import type { FileEntry } from '../../types/file';
import { normalizePath } from '../../utils/filePaths';

type Props = {
  serverId: string;
  activePath: string;
  onNavigate: (path: string) => void;
};

const sortDirectories = (entries: FileEntry[]) =>
  entries.filter((entry) => entry.isDirectory).sort((a, b) => a.name.localeCompare(b.name));

type NodeProps = {
  serverId: string;
  entry: FileEntry;
  depth: number;
  activePath: string;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onNavigate: (path: string) => void;
};

function FileTreeNode({ serverId, entry, depth, activePath, expanded, onToggle, onNavigate }: NodeProps) {
  const isExpanded = expanded.has(entry.path);
  const { data, isLoading } = useQuery({
    queryKey: ['files', serverId, entry.path],
    queryFn: () => filesApi.list(serverId, entry.path),
    enabled: Boolean(serverId) && isExpanded,
    refetchOnWindowFocus: false,
  });
  const childDirectories = useMemo(
    () => (data ? sortDirectories(data.files) : []),
    [data],
  );

  return (
    <div>
      <div className="flex items-center gap-1" style={{ paddingLeft: depth * 12 }}>
        <button
          type="button"
          className="flex h-5 w-5 items-center justify-center rounded border border-slate-200 text-[10px] text-slate-500 dark:text-slate-400 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:text-slate-500 dark:hover:border-primary-500/30"
          onClick={() => onToggle(entry.path)}
          aria-label={isExpanded ? 'Collapse folder' : 'Expand folder'}
        >
          {isExpanded ? '-' : '+'}
        </button>
        <button
          type="button"
          className={`flex-1 rounded-md px-2 py-1 text-left text-xs ${
            normalizePath(activePath) === entry.path
              ? 'bg-primary-500/10 text-primary-600 dark:bg-primary-500/20 dark:text-primary-400'
              : 'text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
          }`}
          onClick={() => onNavigate(entry.path)}
        >
          {entry.name}
        </button>
      </div>
      {isExpanded ? (
        <div className="mt-1 space-y-1">
          {isLoading ? (
            <div className="pl-7 text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500">Loading...</div>
          ) : childDirectories.length ? (
            childDirectories.map((child) => (
              <FileTreeNode
                key={child.path}
                serverId={serverId}
                entry={child}
                depth={depth + 1}
                activePath={activePath}
                expanded={expanded}
                onToggle={onToggle}
                onNavigate={onNavigate}
              />
            ))
          ) : (
            <div className="pl-7 text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500">No subfolders</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function FileTree({ serverId, activePath, onNavigate }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['/']));
  const { data, isLoading, isError } = useQuery({
    queryKey: ['files', serverId, '/'],
    queryFn: () => filesApi.list(serverId, '/'),
    enabled: Boolean(serverId),
    refetchOnWindowFocus: false,
  });

  const directories = useMemo(() => (data ? sortDirectories(data.files) : []), [data]);

  const handleToggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  return (
    <div className="space-y-2 text-sm">
      <button
        type="button"
        className={`w-full rounded-md px-2 py-1 text-left text-xs ${
          normalizePath(activePath) === '/'
            ? 'bg-primary-500/10 text-primary-600 dark:bg-primary-500/20 dark:text-primary-400'
            : 'text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
        }`}
        onClick={() => onNavigate('/')}
      >
        /
      </button>
      {isLoading ? (
        <div className="text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500">Loading directories...</div>
      ) : isError ? (
        <div className="text-xs text-rose-500 dark:text-rose-300">Unable to load directory tree.</div>
      ) : directories.length ? (
        directories.map((entry) => (
          <FileTreeNode
            key={entry.path}
            serverId={serverId}
            entry={entry}
            depth={1}
            activePath={activePath}
            expanded={expanded}
            onToggle={handleToggle}
            onNavigate={onNavigate}
          />
        ))
      ) : (
        <div className="text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500">No folders found.</div>
      )}
    </div>
  );
}

export default FileTree;
