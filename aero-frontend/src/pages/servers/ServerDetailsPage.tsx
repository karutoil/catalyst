import { type FormEvent, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useServer } from '../../hooks/useServer';
import { useServerMetrics } from '../../hooks/useServerMetrics';
import { useServerMetricsHistory } from '../../hooks/useServerMetricsHistory';
import { formatBytes } from '../../utils/formatters';
import { useWebSocketStore } from '../../stores/websocketStore';
import ServerControls from '../../components/servers/ServerControls';
import ServerStatusBadge from '../../components/servers/ServerStatusBadge';
import ServerMetrics from '../../components/servers/ServerMetrics';
import ServerMetricsTrends from '../../components/servers/ServerMetricsTrends';
import UpdateServerModal from '../../components/servers/UpdateServerModal';
import TransferServerModal from '../../components/servers/TransferServerModal';
import DeleteServerDialog from '../../components/servers/DeleteServerDialog';
import FileManager from '../../components/files/FileManager';
import BackupSection from '../../components/backups/BackupSection';
import CreateTaskModal from '../../components/tasks/CreateTaskModal';
import EditTaskModal from '../../components/tasks/EditTaskModal';
import XtermConsole from '../../components/console/XtermConsole';
import { useConsole } from '../../hooks/useConsole';
import { useTasks } from '../../hooks/useTasks';
import { serversApi } from '../../services/api/servers';
import { notifyError, notifySuccess } from '../../utils/notify';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { tasksApi } from '../../services/api/tasks';

const tabLabels = {
  console: 'Console',
  files: 'Files',
  backups: 'Backups',
  tasks: 'Tasks',
  metrics: 'Metrics',
  configuration: 'Configuration',
  settings: 'Settings',
} as const;

function ServerDetailsPage() {
  const { serverId, tab } = useParams();
  const navigate = useNavigate();
  const { data: server, isLoading, isError } = useServer(serverId);
  const liveMetrics = useServerMetrics(serverId, server?.allocatedMemoryMb);
  const { data: metricsHistory } = useServerMetricsHistory(serverId);
  const { data: tasks = [], isLoading: tasksLoading } = useTasks(serverId);
  const { isConnected } = useWebSocketStore();
  const queryClient = useQueryClient();
  const activeTab = useMemo(() => {
    const key = tab ?? 'console';
    return key in tabLabels ? (key as keyof typeof tabLabels) : 'console';
  }, [tab]);

  const {
    entries,
    send,
    isLoading: consoleLoading,
    isError: consoleError,
    refetch: refetchConsole,
    clear: clearConsole,
  } = useConsole(serverId);
  const [command, setCommand] = useState('');
  const canSend = isConnected && Boolean(serverId) && server?.status === 'running';
  const pauseMutation = useMutation({
    mutationFn: (task: { id: string; enabled: boolean }) =>
      tasksApi.update(server.id, task.id, { enabled: !task.enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', server.id] });
      notifySuccess('Task updated');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to update task';
      notifyError(message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (taskId: string) => tasksApi.remove(server.id, taskId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', server.id] });
      notifySuccess('Task deleted');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to delete task';
      notifyError(message);
    },
  });

  const handleSend = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSend) return;
    const trimmed = command.trim();
    if (!trimmed) return;
    send(trimmed);
    setCommand('');
  };
  const handleReinstall = async () => {
    if (!serverId) return;
    try {
      await serversApi.install(serverId);
      notifySuccess('Reinstall started');
    } catch (error: any) {
      const message = error?.response?.data?.error || 'Failed to reinstall server';
      notifyError(message);
    }
  };

  if (isLoading) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-6 text-slate-200">
        Loading server...
      </div>
    );
  }

  if (isError || !server) {
    return (
      <div className="rounded-xl border border-rose-800 bg-rose-950/40 px-4 py-6 text-rose-200">
        Unable to load server details.
      </div>
    );
  }

  const nodeLabel = server.node?.name ?? server.nodeName ?? server.nodeId;
  const isBridge = server.networkMode === 'bridge';
  const nodeIp = isBridge
    ? server.node?.publicAddress ?? server.node?.hostname ?? 'n/a'
    : server.primaryIp ?? 'n/a';
  const nodePort = server.primaryPort ?? 'n/a';

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold text-slate-50">{server.name}</h1>
              <ServerStatusBadge status={server.status} />
            </div>
            <div className="text-sm text-slate-400">
              Node: {nodeLabel} (IP: {nodeIp}, Port: {nodePort})
            </div>
          </div>
          <ServerControls serverId={server.id} status={server.status} />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs">
        {Object.entries(tabLabels).map(([key, label]) => {
          const isActive = activeTab === key;
          return (
            <button
              key={key}
              type="button"
              className={`rounded-full px-3 py-1.5 font-semibold transition ${
                isActive
                  ? 'bg-sky-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
              onClick={() => navigate(`/servers/${server.id}/${key}`)}
            >
              {label}
            </button>
          );
        })}
      </div>

      {activeTab === 'console' ? (
        <div className="rounded-xl border border-slate-800 bg-slate-950">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2 text-xs text-slate-400">
            <span>Console output</span>
            <div className="flex items-center gap-2">
              <span
                className={`flex items-center gap-2 rounded-full border px-2.5 py-1 ${
                  isConnected ? 'border-emerald-500/40 text-emerald-300' : 'border-amber-500/40 text-amber-300'
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                {isConnected ? 'Live' : 'Connecting'}
              </span>
              <button
                type="button"
                className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-700"
                 onClick={() => {
                   clearConsole();
                 }}
               >
                 Clear
               </button>
             </div>
           </div>
            <div className="px-4 py-3">
              {consoleLoading ? <div className="mb-2 text-xs text-slate-500">Loading recent logs...</div> : null}
              {consoleError ? (
               <div className="mb-2 rounded-md border border-rose-900 bg-rose-950/40 px-3 py-2 text-rose-200">
                 <div className="flex items-center justify-between gap-3">
                   <span>Unable to load historical logs.</span>
                   <button
                     type="button"
                     className="rounded-md border border-rose-700 px-2 py-1 text-[11px] text-rose-200 hover:border-rose-600"
                     onClick={() => refetchConsole()}
                   >
                     Retry
                  </button>
                </div>
              </div>
            ) : null}
            <XtermConsole entries={entries} />
            <form onSubmit={handleSend} className="mt-3 flex items-center gap-3">
              <span className="text-xs text-slate-500">&gt;</span>
              <input
                className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                placeholder={canSend ? 'Type here' : 'Connect to send commands'}
                disabled={!canSend}
              />
              <button
                type="submit"
                className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white shadow transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!canSend}
              >
                Send
              </button>
            </form>
          </div>
         </div>
       ) : null}

      {activeTab === 'files' ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4">
          <FileManager serverId={server.id} />
        </div>
      ) : null}

      {activeTab === 'backups' ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4">
          <BackupSection serverId={server.id} serverStatus={server.status} />
        </div>
      ) : null}

      {activeTab === 'tasks' ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-100">Scheduled tasks</div>
              <div className="text-xs text-slate-400">Automate restarts, backups, and commands.</div>
            </div>
            <CreateTaskModal serverId={server.id} />
          </div>
          <div className="mt-4">
            {tasksLoading ? (
              <div className="text-sm text-slate-400">Loading tasks...</div>
            ) : tasks.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/50 px-6 py-8 text-center text-sm text-slate-400">
                No tasks configured for this server yet.
              </div>
            ) : (
              <div className="space-y-3">
                {tasks.map((task) => (
                  <div key={task.id} className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-slate-100">{task.name}</div>
                      <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">
                        {task.action}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      {task.description || 'No description'}
                    </div>
                    <div className="mt-2 text-xs text-slate-500">Schedule: {task.schedule}</div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <EditTaskModal serverId={server.id} task={task} />
                      <button
                        type="button"
                        className={`rounded-md border px-3 py-1 font-semibold ${
                          task.enabled === false
                            ? 'border-emerald-600 text-emerald-200 hover:border-emerald-500'
                            : 'border-amber-600 text-amber-200 hover:border-amber-500'
                        }`}
                        onClick={() => pauseMutation.mutate(task as { id: string; enabled: boolean })}
                        disabled={pauseMutation.isPending}
                      >
                        {task.enabled === false ? 'Resume' : 'Pause'}
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-rose-700 px-3 py-1 font-semibold text-rose-200 hover:border-rose-500"
                        onClick={() => deleteMutation.mutate(task.id)}
                        disabled={deleteMutation.isPending}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

       {activeTab === 'metrics' ? (
         <div className="space-y-4">
           <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
             <ServerMetrics
               cpu={liveMetrics?.cpuPercent ?? server?.cpuPercent ?? 0}
               memory={liveMetrics?.memoryPercent ?? server?.memoryPercent ?? 0}
             />
             <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4 lg:col-span-2">
               <div className="mb-3 flex items-center justify-between">
                 <div className="text-sm font-semibold text-slate-100">Live snapshot</div>
                 <div className={`flex items-center gap-2 text-xs ${isConnected ? 'text-emerald-300' : 'text-slate-400'}`}>
                   <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                   {isConnected ? 'Live' : 'Offline'}
                 </div>
               </div>
               <div className="grid grid-cols-1 gap-3 text-xs text-slate-300 sm:grid-cols-2">
                 <div className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2">
                   <div className="text-slate-400">Memory used</div>
                   <div className="text-sm font-semibold text-slate-100">
                     {liveMetrics?.memoryUsageMb ? `${liveMetrics.memoryUsageMb} MB` : 'n/a'}
                   </div>
                 </div>
                 <div className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2">
                   <div className="text-slate-400">Disk IO (last tick)</div>
                   <div className="text-sm font-semibold text-slate-100">
                     {metricsHistory?.latest?.diskUsageMb ?? 0} MB
                   </div>
                 </div>
                 <div className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2">
                   <div className="text-slate-400">Network RX</div>
                   <div className="text-sm font-semibold text-slate-100">
                     {formatBytes(Number(metricsHistory?.latest?.networkRxBytes ?? 0))}
                   </div>
                 </div>
                 <div className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2">
                   <div className="text-slate-400">Network TX</div>
                   <div className="text-sm font-semibold text-slate-100">
                     {formatBytes(Number(metricsHistory?.latest?.networkTxBytes ?? 0))}
                   </div>
                 </div>
               </div>
             </div>
           </div>
           <ServerMetricsTrends
             history={metricsHistory?.history ?? []}
             latest={metricsHistory?.latest ?? null}
             allocatedMemoryMb={server.allocatedMemoryMb ?? 0}
           />
         </div>
       ) : null}

      {activeTab === 'configuration' ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4">
            <div className="text-sm font-semibold text-slate-100">Server settings</div>
            <div className="mt-3 space-y-2 text-sm text-slate-300">
              <div className="flex items-center justify-between">
                <span>Template</span>
                <span className="text-slate-100">{server.template?.name ?? server.templateId}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Image</span>
                <span className="text-slate-100">{server.template?.image ?? 'n/a'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Memory</span>
                <span className="text-slate-100">{server.allocatedMemoryMb} MB</span>
              </div>
              <div className="flex items-center justify-between">
                <span>CPU cores</span>
                <span className="text-slate-100">{server.allocatedCpuCores}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Primary port</span>
                <span className="text-slate-100">{server.primaryPort}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Network</span>
                <span className="text-slate-100">{server.networkMode}</span>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4">
            <div className="text-sm font-semibold text-slate-100">Environment</div>
            <div className="mt-3 space-y-2 text-xs text-slate-300">
              {server.environment ? (
                Object.entries(server.environment).map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between gap-4">
                    <span className="uppercase tracking-wide text-slate-400">{key}</span>
                    <span className="text-slate-100">{String(value)}</span>
                  </div>
                ))
              ) : (
                <div className="text-slate-500">No environment variables set.</div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === 'settings' ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4">
            <div className="text-sm font-semibold text-slate-100">Maintenance</div>
            <p className="mt-2 text-xs text-slate-400">
              Reinstalling will re-run the template install script and may overwrite files.
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <button
                type="button"
                className="rounded-md bg-amber-600 px-3 py-1 font-semibold text-white shadow hover:bg-amber-500 disabled:opacity-60"
                disabled={server.status !== 'stopped'}
                onClick={handleReinstall}
              >
                Reinstall
              </button>
              <UpdateServerModal serverId={server.id} />
              <TransferServerModal serverId={server.id} />
            </div>
          </div>
          <div className="rounded-xl border border-rose-800 bg-rose-950/40 px-4 py-4">
            <div className="text-sm font-semibold text-rose-100">Danger zone</div>
            <p className="mt-2 text-xs text-rose-200">
              Deleting the server removes all data and cannot be undone.
            </p>
            <div className="mt-3">
              <DeleteServerDialog serverId={server.id} serverName={server.name} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default ServerDetailsPage;
