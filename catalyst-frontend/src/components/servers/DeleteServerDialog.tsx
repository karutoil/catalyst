import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { serversApi } from '../../services/api/servers';
import { notifyError, notifySuccess } from '../../utils/notify';

type Props = {
  serverId: string;
  serverName: string;
  disabled?: boolean;
};

function DeleteServerDialog({ serverId, serverName, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => serversApi.delete(serverId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      notifySuccess('Server deleted');
      setOpen(false);
    },
    onError: () => notifyError('Failed to delete server'),
  });

  return (
    <div>
      <button
        className="rounded-md bg-rose-700 px-3 py-1 text-xs font-semibold text-white shadow hover:bg-rose-600 disabled:opacity-60"
        onClick={() => {
          if (!disabled) setOpen(true);
        }}
        disabled={disabled}
      >
        Delete
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm rounded-xl border border-slate-800 bg-slate-950 p-6 shadow-xl">
            <div className="text-lg font-semibold text-slate-100">Delete server</div>
            <p className="mt-2 text-sm text-slate-300">
              Are you sure you want to delete <span className="font-semibold">{serverName}</span>? This
              action cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2 text-xs">
              <button
                className="rounded-md border border-slate-800 px-3 py-1 font-semibold text-slate-200 hover:border-slate-700"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-rose-700 px-4 py-2 font-semibold text-white shadow hover:bg-rose-600 disabled:opacity-60"
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending || disabled}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default DeleteServerDialog;
