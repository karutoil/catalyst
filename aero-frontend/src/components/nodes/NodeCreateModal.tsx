import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { nodesApi } from '../../services/api/nodes';
import { notifyError, notifySuccess } from '../../utils/notify';

type Props = {
  locationId: string;
};

function NodeCreateModal({ locationId }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [hostname, setHostname] = useState('');
  const [publicAddress, setPublicAddress] = useState('');
  const [memory, setMemory] = useState('16384');
  const [cpu, setCpu] = useState('8');
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      nodesApi.create({
        name,
        description: description || undefined,
        locationId,
        hostname,
        publicAddress,
        maxMemoryMb: Number(memory),
        maxCpuCores: Number(cpu),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nodes'] });
      notifySuccess('Node registered');
      setOpen(false);
      setName('');
      setDescription('');
      setHostname('');
      setPublicAddress('');
      setMemory('16384');
      setCpu('8');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to register node';
      notifyError(message);
    },
  });

  const disableSubmit =
    !name ||
    !locationId ||
    !hostname ||
    !publicAddress ||
    !Number(memory) ||
    !Number(cpu) ||
    mutation.isPending;

  if (!locationId) {
    return (
      <button
        className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 shadow"
        disabled
      >
        Register Node
      </button>
    );
  }

  return (
    <div>
      <button
        className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-sky-500"
        onClick={() => setOpen(true)}
      >
        Register Node
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-800 bg-slate-950 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
              <h2 className="text-lg font-semibold text-slate-100">Register node</h2>
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
                  placeholder="production-1"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-slate-300">Description</span>
                <input
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Primary node"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-slate-300">Hostname</span>
                <input
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                  value={hostname}
                  onChange={(event) => setHostname(event.target.value)}
                  placeholder="node1.example.com"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-slate-300">Public address</span>
                <input
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                  value={publicAddress}
                  onChange={(event) => setPublicAddress(event.target.value)}
                  placeholder="203.0.113.10"
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
                disabled={disableSubmit}
              >
                {mutation.isPending ? 'Registering...' : 'Register node'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default NodeCreateModal;
