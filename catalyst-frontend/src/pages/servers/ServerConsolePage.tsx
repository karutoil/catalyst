import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import ServerStatusBadge from '../../components/servers/ServerStatusBadge';
import { useConsole } from '../../hooks/useConsole';
import { useServer } from '../../hooks/useServer';

const streamStyles: Record<string, string> = {
  stdout: 'text-emerald-500',
  stderr: 'text-rose-500',
  system: 'text-primary-500',
  stdin: 'text-amber-500',
};

function ServerConsolePage() {
  const { serverId } = useParams();
  const { data: server } = useServer(serverId);
  const { entries, send, isConnected, isLoading, isError, refetch, clear } = useConsole(serverId);
  const [command, setCommand] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const outputRef = useRef<HTMLDivElement | null>(null);

  const title = server?.name ?? serverId ?? 'Unknown server';
  const isSuspended = server?.status === 'suspended';
  const canSend = Boolean(serverId) && isConnected && server?.status === 'running' && !isSuspended;

  useEffect(() => {
    if (!outputRef.current || !autoScroll) return;
    outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [entries, autoScroll]);

  useEffect(() => {
    setAutoScroll(true);
  }, [serverId]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSend) return;
    send(command);
    setCommand('');
  };

  const handleScroll = () => {
    if (!outputRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = outputRef.current;
    const nearBottom = scrollHeight - scrollTop - clientHeight < 24;
    setAutoScroll(nearBottom);
  };

  const handleClear = () => {
    clear();
    setAutoScroll(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">
              Console - {title}
            </h1>
            {server?.status ? <ServerStatusBadge status={server.status} /> : null}
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Real-time output and command input.
          </p>
          {isSuspended ? (
            <div className="mt-2 rounded-md border border-rose-200 bg-rose-100/60 px-3 py-2 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
              Server suspended. Console input is disabled.
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span
            className={`flex items-center gap-2 rounded-full border px-2.5 py-1 ${
              isConnected
                ? 'border-emerald-200 text-emerald-600 dark:border-emerald-500/30 dark:text-emerald-300'
                : 'border-amber-200 text-amber-600 dark:border-amber-500/30 dark:text-amber-300'
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                isConnected ? 'bg-emerald-500' : 'bg-amber-500'
              }`}
            />
            {isConnected ? 'Live' : 'Connecting'}
          </span>
          <button
            type="button"
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500/30"
            onClick={handleClear}
          >
            Clear
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-primary-500/30">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2 text-xs text-slate-500 dark:text-slate-400 dark:border-slate-800 dark:text-slate-500">
          <span>WebSocket console output</span>
          <span>{entries.length} lines</span>
        </div>
        <div
          ref={outputRef}
          onScroll={handleScroll}
          className="max-h-[60vh] overflow-y-auto px-4 py-3 font-mono text-xs leading-relaxed text-slate-600 dark:text-slate-200"
        >
          {isLoading ? <div className="text-slate-500 dark:text-slate-400 dark:text-slate-500">Loading recent logs...</div> : null}
          {isError ? (
            <div className="mb-2 rounded-md border border-rose-200 bg-rose-100/60 px-3 py-2 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
              <div className="flex items-center justify-between gap-3">
                <span>Unable to load historical logs.</span>
                <button
                  type="button"
                  className="rounded-md border border-rose-200 px-2 py-1 text-[11px] text-rose-600 transition-all duration-300 hover:border-rose-400 dark:border-rose-500/30 dark:text-rose-300"
                  onClick={() => refetch()}
                >
                  Retry
                </button>
              </div>
            </div>
          ) : null}
          {!isLoading && entries.length === 0 ? (
            <div className="text-slate-500 dark:text-slate-400 dark:text-slate-500">No console output yet.</div>
          ) : (
            entries.map((entry) => (
              <div key={entry.id} className="flex gap-3">
                <span
                  className={`mt-[2px] min-w-[64px] text-[10px] uppercase tracking-wide ${
                    streamStyles[entry.stream] ?? 'text-slate-500 dark:text-slate-500'
                  }`}
                >
                  {entry.stream}
                </span>
                <span className="whitespace-pre-wrap break-words">{entry.data}</span>
              </div>
            ))
          )}
        </div>
        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-3 border-t border-slate-200 px-4 py-3 dark:border-slate-800"
        >
          <span className="text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500">$</span>
          <input
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            placeholder={
              isSuspended
                ? 'Server suspended'
                : canSend
                  ? 'Type a command and press Enter'
                  : 'Connect to send commands'
            }
            disabled={!canSend}
          />
          <button
            type="submit"
            className="rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!canSend}
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

export default ServerConsolePage;
