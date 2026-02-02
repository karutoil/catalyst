import { Link } from 'react-router-dom';
import type { Server } from '../../types/server';
import ServerStatusBadge from './ServerStatusBadge';
import ServerControls from './ServerControls';
import { notifyError } from '../../utils/notify';

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));
const formatPercent = (value?: number | null) =>
  typeof value === 'number' ? `${value.toFixed(0)}%` : 'n/a';

function ServerCard({ server }: { server: Server }) {
  const host =
    server.connection?.host ??
    server.primaryIp ??
    server.node?.publicAddress ??
    server.node?.hostname ??
    'n/a';
  const port = server.connection?.port ?? server.primaryPort ?? 'n/a';
  const cpuPercent =
    typeof server.cpuPercent === 'number' ? clampPercent(server.cpuPercent) : null;
  const memoryPercent =
    typeof server.memoryPercent === 'number'
      ? clampPercent(server.memoryPercent)
      : server.memoryUsageMb != null && server.allocatedMemoryMb
        ? clampPercent((server.memoryUsageMb / server.allocatedMemoryMb) * 100)
        : null;
  const diskTotalMb =
    server.diskTotalMb ?? (server.allocatedDiskMb ? server.allocatedDiskMb : null);
  const diskPercent =
    server.diskUsageMb != null && diskTotalMb
      ? clampPercent((server.diskUsageMb / diskTotalMb) * 100)
      : null;

  const isSuspended = server.status === 'suspended';
  const cpuBar = cpuPercent ?? 0;
  const memoryBar = memoryPercent ?? 0;
  const diskBar = diskPercent ?? 0;

  return (
    <div className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-surface-light transition-all duration-300 hover:-translate-y-1 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:shadow-surface-dark dark:hover:border-primary-500/30">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                to={`/servers/${server.id}`}
                className="text-lg font-semibold text-slate-900 transition-all duration-300 hover:text-primary-600 dark:text-white dark:hover:text-primary-400"
              >
                {server.name}
              </Link>
              <ServerStatusBadge status={server.status} />
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-slate-600 dark:text-slate-400">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 dark:border-slate-800 dark:bg-slate-950/50">
                Node: {server.nodeName ?? server.nodeId}
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 dark:border-slate-800 dark:bg-slate-950/50">
                IP: {host}:{port}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ServerControls serverId={server.id} status={server.status} />
            <Link
              to={isSuspended ? '#' : `/servers/${server.id}/console`}
              className={`rounded-md border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 transition-all duration-300 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 ${
                isSuspended
                  ? 'cursor-not-allowed opacity-60'
                  : 'hover:border-primary-500 hover:text-slate-900 dark:hover:border-primary-500/30'
              }`}
              onClick={(event) => {
                if (isSuspended) {
                  event.preventDefault();
                  notifyError('Server is suspended');
                }
              }}
            >
              Open console
            </Link>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 shadow-surface-light transition-all duration-300 group-hover:border-primary-500 dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-surface-dark dark:group-hover:border-primary-500/30">
            <div className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <span>CPU</span>
              <span className="font-semibold text-slate-700 dark:text-slate-200">
                {formatPercent(cpuPercent)}
              </span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-slate-200 dark:bg-slate-800">
              <div
                className="h-2 rounded-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${cpuBar}%` }}
              />
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 shadow-surface-light transition-all duration-300 group-hover:border-primary-500 dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-surface-dark dark:group-hover:border-primary-500/30">
            <div className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <span>Memory</span>
              <span className="font-semibold text-slate-700 dark:text-slate-200">
                {formatPercent(memoryPercent)}
              </span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-slate-200 dark:bg-slate-800">
              <div
                className="h-2 rounded-full bg-sky-500 transition-all duration-300"
                style={{ width: `${memoryBar}%` }}
              />
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 shadow-surface-light transition-all duration-300 group-hover:border-primary-500 dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-surface-dark dark:group-hover:border-primary-500/30">
            <div className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <span>Disk</span>
              <span className="font-semibold text-slate-700 dark:text-slate-200">
                {server.diskUsageMb != null && diskTotalMb
                  ? `${server.diskUsageMb} / ${diskTotalMb} MB`
                  : formatPercent(diskPercent)}
              </span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-slate-200 dark:bg-slate-800">
              <div
                className="h-2 rounded-full bg-amber-500 transition-all duration-300"
                style={{ width: `${diskBar}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ServerCard;
