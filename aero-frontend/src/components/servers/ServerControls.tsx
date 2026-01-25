import { useMutation, useQueryClient } from '@tanstack/react-query';
import { serversApi } from '../../services/api/servers';
import { notifyError, notifySuccess } from '../../utils/notify';

type Props = {
  serverId: string;
  status: string;
};

function ServerControls({ serverId, status }: Props) {
  const queryClient = useQueryClient();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['servers'] });

  const start = useMutation({
    mutationFn: () => serversApi.start(serverId),
    onSuccess: () => {
      invalidate();
      notifySuccess('Server started');
    },
    onError: () => notifyError('Failed to start server'),
  });
  const stop = useMutation({
    mutationFn: () => serversApi.stop(serverId),
    onSuccess: () => {
      invalidate();
      notifySuccess('Server stopped');
    },
    onError: () => notifyError('Failed to stop server'),
  });
  const restart = useMutation({
    mutationFn: () => serversApi.restart(serverId),
    onSuccess: () => {
      invalidate();
      notifySuccess('Server restarted');
    },
    onError: () => notifyError('Failed to restart server'),
  });
  const kill = useMutation({
    mutationFn: () => serversApi.kill(serverId),
    onSuccess: () => {
      invalidate();
      notifySuccess('Server killed');
    },
    onError: () => notifyError('Failed to kill server'),
  });

  return (
    <div className="flex flex-wrap gap-2 text-xs">
      <button
        className="rounded-md bg-emerald-600 px-3 py-1 font-semibold text-white shadow hover:bg-emerald-500 disabled:opacity-60"
        disabled={start.isPending || status === 'running'}
        onClick={() => start.mutate()}
      >
        Start
      </button>
      <button
        className="rounded-md bg-slate-700 px-3 py-1 font-semibold text-white shadow hover:bg-slate-600 disabled:opacity-60"
        disabled={stop.isPending || status === 'stopped'}
        onClick={() => stop.mutate()}
      >
        Stop
      </button>
      <button
        className="rounded-md bg-sky-600 px-3 py-1 font-semibold text-white shadow hover:bg-sky-500 disabled:opacity-60"
        disabled={restart.isPending}
        onClick={() => restart.mutate()}
      >
        Restart
      </button>
      <button
        className="rounded-md bg-rose-700 px-3 py-1 font-semibold text-white shadow hover:bg-rose-600 disabled:opacity-60"
        disabled={kill.isPending}
        onClick={() => kill.mutate()}
      >
        Kill
      </button>
    </div>
  );
}

export default ServerControls;
