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
        className="rounded-md border border-slate-800 px-3 py-1 text-xs font-semibold text-slate-200 hover:border-slate-700"
        onClick={() => setOpen(true)}
      >
        Update
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-800 bg-slate-950 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
              <h2 className="text-lg font-semibold text-slate-100">Update node</h2>
              <button
                className="rounded-md border border-slate-800 px-2 py-1 text-xs text-slate-300 hover:border-slate-700"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="space-y-3 px-6 py-4 text-sm text-slate-100">
              <label className="block space-y-1">
                <span className="text-slate-300">Name</span>
                <input
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-slate-300">Description</span>
                <input
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-slate-300">Hostname</span>
                <input
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                  value={hostname}
                  onChange={(event) => setHostname(event.target.value)}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-slate-300">Public address</span>
                <input
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                  value={publicAddress}
                  onChange={(event) => setPublicAddress(event.target.value)}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-slate-300">Memory (MB)</span>
                  <input
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                    value={memory}
                    onChange={(event) => setMemory(event.target.value)}
                    type="number"
                    min={256}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-slate-300">CPU cores</span>
                  <input
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                    value={cpu}
                    onChange={(event) => setCpu(event.target.value)}
                    type="number"
                    min={1}
                    step={1}
                  />
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-800 px-6 py-4 text-xs">
              <button
                className="rounded-md border border-slate-800 px-3 py-1 font-semibold text-slate-200 hover:border-slate-700"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-sky-600 px-4 py-2 font-semibold text-white shadow hover:bg-sky-500 disabled:opacity-60"
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
