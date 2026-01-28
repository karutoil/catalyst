import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { serversApi } from '../../services/api/servers';
import type { UpdateServerPayload } from '../../types/server';
import { useServer } from '../../hooks/useServer';
import { useWebSocketStore } from '../../stores/websocketStore';
import { notifyError, notifySuccess } from '../../utils/notify';

type Props = {
  serverId: string;
  disabled?: boolean;
};

function UpdateServerModal({ serverId, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const [memory, setMemory] = useState('1024');
  const [cpu, setCpu] = useState('1');
  const [disk, setDisk] = useState('10240');
  const [name, setName] = useState('');
  const queryClient = useQueryClient();
  const { data: server } = useServer(serverId);
  const { onMessage } = useWebSocketStore();

  const isRunning = server?.status !== 'stopped';
  const memoryValue = Number(memory);
  const cpuValue = Number(cpu);
  const diskValue = Number(disk);
  const existingMemoryMb = server?.allocatedMemoryMb ?? memoryValue;
  const existingCpuCores = server?.allocatedCpuCores ?? cpuValue;
  const existingDiskMb = server?.allocatedDiskMb ?? (diskValue || 10240);
  const isShrink = Number.isFinite(diskValue) && diskValue > 0 && diskValue < existingDiskMb;

  const mutation = useMutation({
    mutationFn: async () => {
      const updates: UpdateServerPayload = {};
      if (name && name !== server?.name) updates.name = name;
      if (Number.isFinite(memoryValue) && memoryValue > 0 && memoryValue !== existingMemoryMb) {
        updates.allocatedMemoryMb = memoryValue;
      }
      if (Number.isFinite(cpuValue) && cpuValue > 0 && cpuValue !== existingCpuCores) {
        updates.allocatedCpuCores = cpuValue;
      }

      if (Object.keys(updates).length) {
        await serversApi.update(serverId, updates);
      }

      if (Number.isFinite(diskValue) && diskValue > 0 && diskValue !== existingDiskMb) {
        return serversApi.resizeStorage(serverId, diskValue);
      }
      return undefined;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['server', serverId] });
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      notifySuccess(diskValue !== existingDiskMb ? 'Storage resize initiated' : 'Server updated');
      setOpen(false);
    },
    onError: () => notifyError('Failed to update server'),
  });

  useEffect(() => {
    if (!server) return;
    setName(server.name ?? '');
    if (server.allocatedMemoryMb) setMemory(String(server.allocatedMemoryMb));
    if (server.allocatedCpuCores) setCpu(String(server.allocatedCpuCores));
    if (server.allocatedDiskMb) setDisk(String(server.allocatedDiskMb));
  }, [server]);

  useEffect(() => {
    const unsubscribe = onMessage((message) => {
      if (message.type !== 'storage_resize_complete' || message.serverId !== serverId) {
        return;
      }
      if (message.success) {
        notifySuccess('Storage resized');
      } else {
        notifyError(message.error || 'Storage resize failed');
      }
      queryClient.invalidateQueries({ queryKey: ['server', serverId] });
      queryClient.invalidateQueries({ queryKey: ['servers'] });
    });
    return unsubscribe;
  }, [onMessage, queryClient, serverId]);

  return (
    <div>
      <button
        className="rounded-md border border-slate-800 px-3 py-1 text-xs font-semibold text-slate-200 hover:border-slate-700 disabled:opacity-60"
        onClick={() => {
          if (!disabled) setOpen(true);
        }}
        disabled={disabled}
      >
        Update
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-950 p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-100">Update server</h2>
              <button
                className="rounded-md border border-slate-800 px-2 py-1 text-xs text-slate-300 hover:border-slate-700"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="mt-4 space-y-3 text-sm text-slate-100">
              <label className="block space-y-1">
                <span className="text-slate-300">Name</span>
                <input
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="minecraft-01"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-slate-300">Memory (MB)</span>
                <input
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                  value={memory}
                  onChange={(e) => setMemory(e.target.value)}
                  type="number"
                  min={256}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-slate-300">CPU cores</span>
                <input
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                  value={cpu}
                  onChange={(e) => setCpu(e.target.value)}
                  type="number"
                  min={1}
                  step={1}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-slate-300">Disk (MB)</span>
                <input
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                  value={disk}
                  onChange={(e) => setDisk(e.target.value)}
                  type="number"
                  min={1024}
                  step={1024}
                />
                {isRunning && isShrink ? (
                  <span className="text-xs text-amber-300">
                    Shrinking requires the server to be stopped.
                  </span>
                ) : null}
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2 text-xs">
              <button
                className="rounded-md border border-slate-800 px-3 py-1 font-semibold text-slate-200 hover:border-slate-700"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
                <button
                  className="rounded-md bg-sky-600 px-4 py-2 font-semibold text-white shadow hover:bg-sky-500 disabled:opacity-60"
                  onClick={() => mutation.mutate()}
                  disabled={mutation.isPending || (isRunning && isShrink) || disabled}
                >
                  Save changes
                </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default UpdateServerModal;
