import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import FileEditor from './FileEditor';
import FileList from './FileList';
import FileTree from './FileTree';
import FileUploader from './FileUploader';
import { useFileManager } from '../../hooks/useFileManager';
import { filesApi } from '../../services/api/files';
import type { FileEntry } from '../../types/file';
import { formatFileMode } from '../../utils/formatters';
import { notifyError, notifyInfo, notifySuccess } from '../../utils/notify';
import { buildBreadcrumbs, getParentPath, joinPath, normalizePath } from '../../utils/filePaths';

type CreatePayload = {
  name: string;
  isDirectory: boolean;
  content?: string;
};

const isArchive = (name: string) =>
  name.endsWith('.tar.gz') || name.endsWith('.tgz') || name.endsWith('.zip');

function FileManager({ serverId, isSuspended = false }: { serverId: string; isSuspended?: boolean }) {
  const {
    path,
    setPath,
    files,
    message,
    isLoading,
    isError,
    refetch,
    activeFile,
    isFileLoading,
    isDirty,
    openFile,
    updateActiveContent,
    markActiveSaved,
    closeActiveFile,
  } = useFileManager(serverId);
  const queryClient = useQueryClient();

  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [showUpload, setShowUpload] = useState(false);
  const [createMode, setCreateMode] = useState<'file' | 'directory' | null>(null);
  const [createName, setCreateName] = useState('');
  const [createContent, setCreateContent] = useState('');
  const [showCompress, setShowCompress] = useState(false);
  const [showDecompress, setShowDecompress] = useState(false);
  const [archiveName, setArchiveName] = useState('archive.tar.gz');
  const [decompressTarget, setDecompressTarget] = useState(path);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [permissionsEntry, setPermissionsEntry] = useState<FileEntry | null>(null);
  const [permissionsValue, setPermissionsValue] = useState('');
  const [permissionsError, setPermissionsError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedPaths(new Set());
    setConfirmDelete(false);
    setShowCompress(false);
    setShowDecompress(false);
    setPermissionsEntry(null);
    setPermissionsError(null);
  }, [path]);

  useEffect(() => {
    setDecompressTarget(path);
  }, [path]);

  useEffect(() => {
    if (!selectedPaths.size) {
      setConfirmDelete(false);
      setShowCompress(false);
      setShowDecompress(false);
    }
  }, [selectedPaths]);

  const sortedFiles = useMemo(() => {
    const next = [...files];
    next.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
    return next;
  }, [files]);

  const breadcrumbs = useMemo(() => buildBreadcrumbs(path), [path]);
  const selectedEntries = useMemo(
    () => sortedFiles.filter((entry) => selectedPaths.has(entry.path)),
    [sortedFiles, selectedPaths],
  );
  const selectedArchive =
    selectedEntries.length === 1 &&
    !selectedEntries[0].isDirectory &&
    isArchive(selectedEntries[0].name)
      ? selectedEntries[0]
      : undefined;

  const invalidateFiles = () => {
    queryClient.invalidateQueries({ queryKey: ['files', serverId] });
  };

  const createMutation = useMutation({
    mutationFn: async ({ name, isDirectory, content }: CreatePayload) => {
      const targetPath = joinPath(path, name);
      if (isDirectory) {
        await filesApi.create(serverId, { path: targetPath, isDirectory: true });
        return { name, path: targetPath, isDirectory: true, size: 0 } as FileEntry;
      }
      try {
        await filesApi.create(serverId, { path: targetPath, isDirectory: false, content });
      } catch {
        await filesApi.write(serverId, targetPath, content ?? '');
      }
      return { name, path: targetPath, isDirectory: false, size: 0 } as FileEntry;
    },
    onSuccess: (entry) => {
      invalidateFiles();
      setCreateName('');
      setCreateContent('');
      setCreateMode(null);
      notifySuccess(entry.isDirectory ? 'Folder created' : 'File created');
      if (!entry.isDirectory) {
        openFile(entry);
      }
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || error?.message || 'Failed to create item';
      notifyError(message);
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!activeFile) return;
      await filesApi.write(serverId, activeFile.path, activeFile.content);
    },
    onSuccess: () => {
      markActiveSaved();
      notifySuccess('File saved');
      invalidateFiles();
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || error?.message || 'Failed to save file';
      notifyError(message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (paths: string[]) => {
      await Promise.all(paths.map((target) => filesApi.remove(serverId, target)));
    },
    onSuccess: (_, paths) => {
      invalidateFiles();
      setSelectedPaths(new Set());
      setConfirmDelete(false);
      if (activeFile && paths.includes(activeFile.path)) {
        closeActiveFile();
      }
      notifySuccess('Deleted selection');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || error?.message || 'Failed to delete selection';
      notifyError(message);
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (uploadFiles: File[]) => {
      await filesApi.upload(serverId, path, uploadFiles);
    },
    onSuccess: () => {
      invalidateFiles();
      setShowUpload(false);
      notifySuccess('Upload complete');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || error?.message || 'Failed to upload files';
      notifyError(message);
    },
  });

  const compressMutation = useMutation({
    mutationFn: async ({ paths, archive }: { paths: string[]; archive: string }) => filesApi.compress(serverId, { paths, archiveName: archive }),
    onSuccess: (data) => {
      invalidateFiles();
      setShowCompress(false);
      notifySuccess(data?.archivePath ? `Archive created at ${data.archivePath}` : 'Archive created');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || error?.message || 'Failed to compress files';
      notifyError(message);
    },
  });

  const decompressMutation = useMutation({
    mutationFn: async ({ archivePath, targetPath }: { archivePath: string; targetPath: string }) => filesApi.decompress(serverId, { archivePath, targetPath }),
    onSuccess: () => {
      invalidateFiles();
      setShowDecompress(false);
      notifySuccess('Archive extracted');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || error?.message || 'Failed to extract archive';
      notifyError(message);
    },
  });

  const permissionsMutation = useMutation({
    mutationFn: async ({ path: targetPath, mode }: { path: string; mode: number }) => filesApi.updatePermissions(serverId, targetPath, mode),
    onSuccess: () => {
      invalidateFiles();
      setPermissionsEntry(null);
      notifySuccess('Permissions updated');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || error?.message || 'Failed to update permissions';
      notifyError(message);
    },
  });

  const handleOpen = (entry: FileEntry) => {
    if (entry.isDirectory) {
      setPath(entry.path);
      return;
    }
    openFile(entry);
  };

  const handleSelect = (entry: FileEntry, selected: boolean) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (selected) {
        next.add(entry.path);
      } else {
        next.delete(entry.path);
      }
      return next;
    });
  };

  const handleDownload = async (entry: FileEntry) => {
    try {
      const blob = await filesApi.download(serverId, entry.path);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = entry.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      notifyInfo('Download started');
    } catch {
      notifyError('Failed to download file');
    }
  };

  const handleCreateSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!createMode) return;
    const name = createName.trim();
    if (!name) return;
    createMutation.mutate({ name, isDirectory: createMode === 'directory', content: createContent });
  };

  const handleCompress = () => {
    const selected = Array.from(selectedPaths);
    const name = archiveName.trim();
    if (!selected.length || !name) {
      notifyError('Select files and provide an archive name');
      return;
    }
    const archivePath = name.startsWith('/') ? normalizePath(name) : joinPath(path, name);
    compressMutation.mutate({ paths: selected, archive: archivePath });
  };

  const handleDecompress = () => {
    if (!selectedArchive) return;
    const target = normalizePath(decompressTarget);
    decompressMutation.mutate({ archivePath: selectedArchive.path, targetPath: target });
  };

  const handleDeleteSelection = () => {
    const selected = Array.from(selectedPaths);
    if (!selected.length) return;
    deleteMutation.mutate(selected);
  };

  const parseModeInput = (value: string) => {
    const trimmed = value.trim();
    if (!/^[0-7]{3,4}$/.test(trimmed)) return null;
    const parsed = parseInt(trimmed, 8);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const handlePermissionsOpen = (entry: FileEntry) => {
    const fallback = entry.isDirectory ? 0o755 : 0o644;
    const formatted = formatFileMode(entry.mode ?? fallback);
    setPermissionsValue(formatted === '---' ? '644' : formatted);
    setPermissionsEntry(entry);
    setPermissionsError(null);
  };

  const handlePermissionsSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!permissionsEntry) return;
    const parsed = parseModeInput(permissionsValue);
    if (!parsed) {
      setPermissionsError('Enter a 3-4 digit octal mode, e.g. 644 or 0755.');
      return;
    }
    setPermissionsError(null);
    permissionsMutation.mutate({ path: permissionsEntry.path, mode: parsed });
  };

  const handleBulkCompressFromEntry = (entry: FileEntry) => {
    setSelectedPaths(new Set([entry.path]));
    setArchiveName(entry.name.endsWith('.tar.gz') ? entry.name : `${entry.name}.tar.gz`);
    setShowCompress(true);
  };

  const handleBulkDecompressFromEntry = (entry: FileEntry) => {
    if (!isArchive(entry.name)) return;
    setSelectedPaths(new Set([entry.path]));
    setShowDecompress(true);
  };

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[240px,1fr]">
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Folders
        </div>
        <FileTree serverId={serverId} activePath={path} onNavigate={(nextPath) => setPath(nextPath)} />
      </div>

      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-white">Path</div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <button
                  type="button"
                  className="rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-500 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                  onClick={() => setPath(getParentPath(path))}
                  disabled={path === '/'}
                >
                  Up
                </button>
                <nav className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="rounded-md px-2 py-1 text-[11px] text-slate-500 transition-all duration-300 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                    onClick={() => setPath('/')}
                  >
                    /
                  </button>
                  {breadcrumbs.map((crumb) => (
                    <div key={crumb.path} className="flex items-center gap-2">
                      <span className="text-slate-500 dark:text-slate-400 dark:text-slate-500">/</span>
                      <button
                        type="button"
                        className="rounded-md px-2 py-1 text-[11px] text-slate-500 transition-all duration-300 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                        onClick={() => setPath(crumb.path)}
                      >
                        {crumb.name}
                      </button>
                    </div>
                  ))}
                </nav>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                className="rounded-md border border-slate-200 px-3 py-1 text-xs text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setShowUpload((prev) => !prev)}
                disabled={isSuspended}
              >
                Upload
              </button>
              <button
                type="button"
                className="rounded-md border border-slate-200 px-3 py-1 text-xs text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setCreateMode('file')}
                disabled={isSuspended}
              >
                New file
              </button>
              <button
                type="button"
                className="rounded-md border border-slate-200 px-3 py-1 text-xs text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setCreateMode('directory')}
                disabled={isSuspended}
              >
                New folder
              </button>
              <button
                type="button"
                className="rounded-md border border-slate-200 px-3 py-1 text-xs text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => refetch()}
              >
                Refresh
              </button>
            </div>
        </div>
          {message ? (
            <div className="mt-3 text-xs text-amber-600 dark:text-amber-300">{message}</div>
          ) : null}
          {selectedEntries.length ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-300">
              <span>Selected {selectedEntries.length}</span>
              <button
                type="button"
                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setShowCompress(true)}
                disabled={isSuspended}
              >
                Compress
              </button>
              {selectedArchive ? (
                <button
                  type="button"
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                  onClick={() => setShowDecompress(true)}
                  disabled={isSuspended}
                >
                  Decompress
                </button>
              ) : null}
              <button
                type="button"
                className="rounded-md border border-rose-200 px-2 py-1 text-xs text-rose-600 transition-all duration-300 hover:border-rose-400 dark:border-rose-500/30 dark:text-rose-400"
                onClick={() => setConfirmDelete(true)}
                disabled={isSuspended}
              >
                Delete
              </button>
              <button
                type="button"
                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setSelectedPaths(new Set())}
              >
                Clear
              </button>
            </div>
          ) : null}
        </div>

        {showUpload ? (
          <FileUploader
            path={path}
            isUploading={uploadMutation.isPending}
            onUpload={(filesToUpload) => uploadMutation.mutate(filesToUpload)}
            onClose={() => setShowUpload(false)}
          />
        ) : null}

        {createMode ? (
          <form
            className="rounded-lg border border-slate-200 bg-white px-4 py-4 text-sm text-slate-600 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500/30"
            onSubmit={handleCreateSubmit}
          >
            <div className="flex items-center justify-between">
              <div className="font-semibold text-slate-900 dark:text-white">
                {createMode === 'directory' ? 'Create folder' : 'Create file'}
              </div>
              <button
                type="button"
                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setCreateMode(null)}
              >
                Close
              </button>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
                Name
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                  value={createName}
                  onChange={(event) => setCreateName(event.target.value)}
                  placeholder={createMode === 'directory' ? 'configs' : 'server.properties'}
                />
              </label>
              {createMode === 'file' ? (
                <label className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
                  Initial content
                  <textarea
                    className="h-24 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                    value={createContent}
                    onChange={(event) => setCreateContent(event.target.value)}
                    placeholder="# New file"
                  />
                </label>
              ) : null}
            </div>
            <div className="mt-3 flex justify-end gap-2 text-xs">
              <button
                type="button"
                className="rounded-md border border-slate-200 px-3 py-1 text-xs text-slate-500 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setCreateMode(null)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-md bg-primary-600 px-3 py-2 text-xs font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
                disabled={!createName.trim() || createMutation.isPending || isSuspended}
              >
                Create
              </button>
            </div>
          </form>
        ) : null}

        {showCompress ? (
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-4 text-sm text-slate-600 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500/30">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-slate-900 dark:text-white">Compress selection</div>
              <button
                type="button"
                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setShowCompress(false)}
              >
                Close
              </button>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
                Archive name
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                  value={archiveName}
                  onChange={(event) => setArchiveName(event.target.value)}
                  placeholder="archive.tar.gz"
                />
              </label>
              <div className="text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500">
                {selectedEntries.length} item(s) selected
              </div>
            </div>
            <div className="mt-3 flex justify-end gap-2 text-xs">
              <button
                type="button"
                className="rounded-md bg-primary-600 px-3 py-2 text-xs font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
                onClick={handleCompress}
                disabled={!selectedEntries.length || compressMutation.isPending || isSuspended}
              >
                Create archive
              </button>
            </div>
          </div>
        ) : null}

        {showDecompress && selectedArchive ? (
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-4 text-sm text-slate-600 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500/30">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-slate-900 dark:text-white">Decompress archive</div>
              <button
                type="button"
                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setShowDecompress(false)}
              >
                Close
              </button>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
                Target path
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                  value={decompressTarget}
                  onChange={(event) => setDecompressTarget(event.target.value)}
                  placeholder="/"
                />
              </label>
              <div className="text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500">
                Archive: {selectedArchive.name}
              </div>
            </div>
            <div className="mt-3 flex justify-end gap-2 text-xs">
              <button
                type="button"
                className="rounded-md bg-primary-600 px-3 py-2 text-xs font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
                onClick={handleDecompress}
                disabled={decompressMutation.isPending || isSuspended}
              >
                Extract
              </button>
            </div>
          </div>
        ) : null}

        {confirmDelete && selectedEntries.length ? (
          <div className="rounded-lg border border-rose-200 bg-rose-100/60 px-4 py-4 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                Delete {selectedEntries.length} item(s)? This action cannot be undone.
              </div>
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  className="rounded-md border border-rose-200 px-3 py-1 text-xs text-rose-700 transition-all duration-300 hover:border-rose-400 dark:border-rose-500/30 dark:text-rose-300"
                  onClick={handleDeleteSelection}
                  disabled={deleteMutation.isPending || isSuspended}
                >
                  Confirm delete
                </button>
                <button
                  type="button"
                  className="rounded-md border border-slate-200 px-3 py-1 text-xs text-slate-500 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                  onClick={() => setConfirmDelete(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="rounded-xl border border-slate-200 bg-white shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 text-xs text-slate-500 dark:text-slate-400 dark:border-slate-800">
            <span>Files</span>
            <span>{sortedFiles.length} items</span>
          </div>
          <FileList
            files={sortedFiles}
            selectedPaths={selectedPaths}
            isLoading={isLoading}
            isError={isError}
            onOpen={handleOpen}
            onSelect={handleSelect}
            onDownload={handleDownload}
            onDelete={(entry) => {
              if (isSuspended) {
                notifyError('Server is suspended');
                return;
              }
              setSelectedPaths(new Set([entry.path]));
              setConfirmDelete(true);
            }}
            onCompress={(entry) => {
              if (isSuspended) {
                notifyError('Server is suspended');
                return;
              }
              handleBulkCompressFromEntry(entry);
            }}
            onDecompress={(entry) => {
              if (isSuspended) {
                notifyError('Server is suspended');
                return;
              }
              handleBulkDecompressFromEntry(entry);
            }}
            onPermissions={(entry) => {
              if (isSuspended) {
                notifyError('Server is suspended');
                return;
              }
              handlePermissionsOpen(entry);
            }}
          />
        </div>
      </div>

      {activeFile ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
          <div
            className="absolute inset-0 bg-white dark:bg-slate-950/70 backdrop-blur-sm"
            onClick={closeActiveFile}
          />
          <div className="relative z-10 h-[90vh] w-[90vw] rounded-xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <FileEditor
              file={activeFile}
              isLoading={isFileLoading}
              isSaving={saveMutation.isPending}
              isDirty={isDirty}
              onChange={updateActiveContent}
              onSave={() => saveMutation.mutate()}
              onDownload={() => handleDownload(activeFile)}
              onReset={() => {
                if (!activeFile) return;
                updateActiveContent(activeFile.originalContent);
              }}
              onClose={closeActiveFile}
              height="calc(90vh - 140px)"
              isSuspended={isSuspended}
            />
          </div>
        </div>
      ) : null}

      {permissionsEntry ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
          <div
            className="absolute inset-0 bg-white dark:bg-slate-950/70 backdrop-blur-sm"
            onClick={() => setPermissionsEntry(null)}
          />
          <form
            className="relative z-10 w-full max-w-lg rounded-xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
            onSubmit={handlePermissionsSubmit}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900 dark:text-white">
                  Edit permissions
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500">
                  {permissionsEntry.path}
                </div>
              </div>
              <button
                type="button"
                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setPermissionsEntry(null)}
              >
                Close
              </button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
                Mode (octal)
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                  value={permissionsValue}
                  onChange={(event) => {
                    setPermissionsValue(event.target.value);
                    setPermissionsError(null);
                  }}
                  placeholder={permissionsEntry.isDirectory ? '755' : '644'}
                />
              </label>
              <div className="text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500">
                Use three or four digits. Example: 644 for files, 755 for folders.
              </div>
            </div>
            {permissionsError ? (
              <div className="mt-3 rounded-md border border-rose-200 bg-rose-100/60 px-3 py-2 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                {permissionsError}
              </div>
            ) : null}
            <div className="mt-4 flex justify-end gap-2 text-xs">
              <button
                type="button"
                className="rounded-md border border-slate-200 px-3 py-1 text-xs text-slate-500 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setPermissionsEntry(null)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-md bg-primary-600 px-3 py-2 text-xs font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
                disabled={permissionsMutation.isPending || isSuspended}
              >
                Update
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

export default FileManager;
