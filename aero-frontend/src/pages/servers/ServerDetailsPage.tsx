import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useServer } from '../../hooks/useServer';
import { useServerMetrics } from '../../hooks/useServerMetrics';
import { useServerEvents } from '../../hooks/useServerEvents';
import { useWebSocketStore } from '../../stores/websocketStore';
import ServerControls from '../../components/servers/ServerControls';
import ServerStatusBadge from '../../components/servers/ServerStatusBadge';
import ServerMetrics from '../../components/servers/ServerMetrics';
import UpdateServerModal from '../../components/servers/UpdateServerModal';
import TransferServerModal from '../../components/servers/TransferServerModal';
import DeleteServerDialog from '../../components/servers/DeleteServerDialog';
import FileManager from '../../components/files/FileManager';
import BackupSection from '../../components/backups/BackupSection';
import { useConsole } from '../../hooks/useConsole';
import { serversApi } from '../../services/api/servers';
import { notifyError, notifySuccess } from '../../utils/notify';

const streamStyles: Record<string, string> = {
  stdout: 'text-emerald-400',
  stderr: 'text-rose-400',
  system: 'text-sky-400',
  stdin: 'text-amber-300',
};

const tabLabels = {
  console: 'Console',
  files: 'Files',
  backups: 'Backups',
  metrics: 'Metrics',
  configuration: 'Configuration',
  settings: 'Settings',
} as const;

function ServerDetailsPage() {
  const { serverId, tab } = useParams();
  const navigate = useNavigate();
  const { data: server, isLoading, isError } = useServer(serverId);
  const liveMetrics = useServerMetrics(serverId, server?.allocatedMemoryMb);
  const events = useServerEvents(serverId);
  const { isConnected } = useWebSocketStore();
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
  const [autoScroll, setAutoScroll] = useState(true);
  const outputRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!outputRef.current || !autoScroll) return;
    outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [entries, autoScroll]);

  useEffect(() => {
    setAutoScroll(true);
  }, [serverId, activeTab]);

  const handleSend = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = command.trim();
    if (!trimmed) return;
    send(command);
    setCommand('');
  };

  const handleScroll = () => {
    if (!outputRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = outputRef.current;
    const nearBottom = scrollHeight - scrollTop - clientHeight < 24;
    setAutoScroll(nearBottom);
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
                  setAutoScroll(true);
                }}
              >
                Clear
              </button>
            </div>
          </div>
          <div
            ref={outputRef}
            onScroll={handleScroll}
            className="max-h-[60vh] overflow-y-auto px-4 py-3 font-mono text-xs leading-relaxed text-slate-200"
          >
            {consoleLoading ? <div className="text-slate-500">Loading recent logs...</div> : null}
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
            {!consoleLoading && entries.length === 0 ? (
              <div className="text-slate-500">No console output yet.</div>
            ) : (
              entries.map((entry) => (
                <div key={entry.id} className="flex gap-3">
                  <span
                    className={`mt-[2px] min-w-[64px] text-[10px] uppercase tracking-wide ${
                      streamStyles[entry.stream] ?? 'text-slate-500'
                    }`}
                  >
                    {entry.stream}
                  </span>
                  <span className="whitespace-pre-wrap break-words">{entry.data}</span>
                </div>
              ))
            )}
          </div>
          <form onSubmit={handleSend} className="flex items-center gap-3 border-t border-slate-800 px-4 py-3">
            <span className="text-xs text-slate-500">$</span>
            <input
              className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              placeholder={isConnected ? 'Type a command and press Enter' : 'Connect to send commands'}
              disabled={!isConnected}
            />
            <button
              type="submit"
              className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white shadow transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!isConnected}
            >
              Send
            </button>
          </form>
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

      {activeTab === 'metrics' ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <ServerMetrics
            cpu={liveMetrics?.cpuPercent ?? server?.cpuPercent ?? 0}
            memory={liveMetrics?.memoryPercent ?? server?.memoryPercent ?? 0}
          />
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4 lg:col-span-2">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-100">Recent events</div>
              <div
                className={`flex items-center gap-1 text-xs ${isConnected ? 'text-emerald-400' : 'text-slate-400'}`}
              >
                <div className={`h-2 w-2 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                {isConnected ? 'Live' : 'Offline'}
              </div>
            </div>
            <ul className="space-y-2 text-sm text-slate-300">
              {events.length > 0 ? (
                events.map((event) => (
                  <li key={event.id} className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                      <span className="uppercase tracking-wide">{event.stream ?? 'event'}</span>
                      <span>{new Date(event.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <div className="mt-1 text-sm text-slate-100">{event.message}</div>
                  </li>
                ))
              ) : (
                <>
                  <li className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2">
                    {isConnected
                      ? 'Connected to WebSocket - ready for real-time updates.'
                      : 'Connecting to real-time updates...'}
                  </li>
                  <li className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2">
                    {liveMetrics ? 'Receiving live metrics updates.' : 'Waiting for metrics stream...'}
                  </li>
                </>
              )}
            </ul>
          </div>
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
