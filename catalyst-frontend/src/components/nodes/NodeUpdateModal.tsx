import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { NodeInfo } from '../../types/node';
import { nodesApi } from '../../services/api/nodes';
import { notifyError, notifySuccess } from '../../utils/notify';

function NodeUpdateModal({ node }: { node: NodeInfo }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(node.name);
  const [description, setDescription] = useState(node.description ?? '');
  const [hostname, setHostname] = useState(node.hostname ?? '');
  const [publicAddress, setPublicAddress] = useState(node.publicAddress ?? '');
  const [memory, setMemory] = useState(String(node.maxMemoryMb ?? 0));
  const [cpu, setCpu] = useState(String(node.maxCpuCores ?? 0));
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      nodesApi.update(node.id, {
        name: name || undefined,
        description: description || undefined,
        hostname: hostname || undefined,
        publicAddress: publicAddress || undefined,
        maxMemoryMb: Number(memory) || undefined,
        maxCpuCores: Number(cpu) || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nodes'] });
      queryClient.invalidateQueries({ queryKey: ['node', node.id] });
      notifySuccess('Node updated');
      setOpen(false);
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to update node';
      notifyError(message);
    },
  });

  return (
    <div>
      <button
        className="rounded-md border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500/30"
        onClick={() => setOpen(true)}
      >
        Update
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white dark:bg-slate-950/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-surface-light dark:shadow-surface-dark transition-all duration-300 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Update node</h2>
              <button
                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="space-y-3 px-6 py-4 text-sm text-slate-600 dark:text-slate-300">
              <label className="block space-y-1">
                <span className="text-slate-500 dark:text-slate-400">Name</span>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-slate-500 dark:text-slate-400">Description</span>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-slate-500 dark:text-slate-400">Hostname</span>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                  value={hostname}
                  onChange={(event) => setHostname(event.target.value)}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-slate-500 dark:text-slate-400">Public address</span>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                  value={publicAddress}
                  onChange={(event) => setPublicAddress(event.target.value)}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-slate-500 dark:text-slate-400">Memory (MB)</span>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                    value={memory}
                    onChange={(event) => setMemory(event.target.value)}
                    type="number"
                    min={256}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-slate-500 dark:text-slate-400">CPU cores</span>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                    value={cpu}
                    onChange={(event) => setCpu(event.target.value)}
                    type="number"
                    min={1}
                    step={1}
                  />
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4 text-xs dark:border-slate-800">
              <button
                className="rounded-md border border-slate-200 px-3 py-1 font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-primary-600 px-4 py-2 font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending}
              >
                {mutation.isPending ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default NodeUpdateModal;
