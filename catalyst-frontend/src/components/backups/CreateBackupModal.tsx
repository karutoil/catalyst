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
        className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-sky-500 disabled:opacity-60"
        onClick={() => {
          if (!disabled) setOpen(true);
        }}
        disabled={disabled}
      >
        Create Backup
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-950 p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-100">Create backup</h2>
              <button
                className="rounded-md border border-slate-800 px-2 py-1 text-xs text-slate-300 hover:border-slate-700"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="mt-4 space-y-3 text-sm text-slate-100">
              <label className="block space-y-1">
                <span className="text-slate-300">Backup name (optional)</span>
                <input
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="nightly-backup"
                />
              </label>
              <p className="text-xs text-slate-400">
                Leave blank to auto-generate a name with the current timestamp.
              </p>
            </div>
            <div className="mt-5 flex justify-end gap-2 text-xs">
              <button
                className="rounded-md border border-slate-800 px-3 py-1 font-semibold text-slate-200 hover:border-slate-700"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
                <button
                  className="rounded-md bg-sky-600 px-4 py-2 font-semibold text-white shadow hover:bg-sky-500 disabled:opacity-60"
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
