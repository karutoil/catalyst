import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { backupsApi } from '../../services/api/backups';
import { notifyError, notifySuccess } from '../../utils/notify';

function CreateBackupModal({ serverId, disabled = false }: { serverId: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => backupsApi.create(serverId, { name: name.trim() || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backups', serverId] });
      notifySuccess('Backup creation started');
      setOpen(false);
      setName('');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to create backup';
      notifyError(message);
    },
  });

  return (
    <div>
      <button
        type="button"
        className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
        onClick={() => {
          if (!disabled) setOpen(true);
        }}
        disabled={disabled}
      >
        Create Backup
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Create backup</h2>
              <button
                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="mt-4 space-y-3 text-sm text-slate-900 dark:text-slate-100">
              <label className="block space-y-1">
                <span className="text-slate-600 dark:text-slate-300">Backup name (optional)</span>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="nightly-backup"
                />
              </label>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Leave blank to auto-generate a name with the current timestamp.
              </p>
            </div>
            <div className="mt-5 flex justify-end gap-2 text-xs">
              <button
                className="rounded-md border border-slate-200 px-3 py-1 font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-primary-600 px-4 py-2 font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending || disabled}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default CreateBackupModal;
