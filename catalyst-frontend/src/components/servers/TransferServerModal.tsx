import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { serversApi } from '../../services/api/servers';
import { useNodes } from '../../hooks/useNodes';
import { notifyError, notifySuccess } from '../../utils/notify';

type Props = {
  serverId: string;
  disabled?: boolean;
};

function TransferServerModal({ serverId, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const [targetNodeId, setTargetNodeId] = useState('');
  const queryClient = useQueryClient();
  const { data: nodes = [], isLoading: nodesLoading } = useNodes();

  const mutation = useMutation({
    mutationFn: () => serversApi.transfer(serverId, { targetNodeId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['server', serverId] });
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      notifySuccess('Transfer started');
      setOpen(false);
    },
    onError: () => notifyError('Failed to transfer server'),
  });

  useEffect(() => {
    if (!targetNodeId && nodes.length) {
      setTargetNodeId(nodes[0].id);
    }
  }, [nodes, targetNodeId]);

  return (
    <div>
      <button
        className="rounded-md border border-slate-800 px-3 py-1 text-xs font-semibold text-slate-200 hover:border-slate-700 disabled:opacity-60"
        onClick={() => {
          if (!disabled) setOpen(true);
        }}
        disabled={disabled}
      >
        Transfer
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-950 p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-100">Transfer server</h2>
              <button
                className="rounded-md border border-slate-800 px-2 py-1 text-xs text-slate-300 hover:border-slate-700"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="mt-4 space-y-3 text-sm text-slate-100">
              <label className="block space-y-1">
                <span className="text-slate-300">Target node</span>
                <select
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                  value={targetNodeId}
                  onChange={(e) => setTargetNodeId(e.target.value)}
                  disabled={nodesLoading || !nodes.length}
                >
                  {!nodes.length ? <option value="">No nodes available</option> : null}
                  {nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-slate-400">Transferring will reschedule workloads on the selected node.</p>
            </div>
            <div className="mt-4 flex justify-end gap-2 text-xs">
              <button
                className="rounded-md border border-slate-800 px-3 py-1 font-semibold text-slate-200 hover:border-slate-700"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
                <button
                  className="rounded-md bg-purple-600 px-4 py-2 font-semibold text-white shadow hover:bg-purple-500 disabled:opacity-60"
                  onClick={() => mutation.mutate()}
                  disabled={mutation.isPending || !targetNodeId || !nodes.length || disabled}
                >
                  Transfer
                </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default TransferServerModal;
