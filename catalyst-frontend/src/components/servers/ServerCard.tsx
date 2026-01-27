import { Link } from 'react-router-dom';
import type { Server } from '../../types/server';
import ServerStatusBadge from './ServerStatusBadge';
import ServerControls from './ServerControls';

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

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Link
              to={`/servers/${server.id}`}
              className="text-lg font-semibold text-slate-50 hover:text-white"
            >
              {server.name}
            </Link>
            <ServerStatusBadge status={server.status} />
          </div>
          <div className="text-xs text-slate-400">Node: {server.nodeName ?? server.nodeId}</div>
          <div className="text-xs text-slate-400">IP: {host}:{port}</div>
        </div>
        <div className="flex items-center gap-2">
          <ServerControls serverId={server.id} status={server.status} />
          <Link
            to={`/servers/${server.id}/console`}
            className="rounded-md border border-slate-800 bg-slate-900 px-3 py-1 text-xs font-semibold text-slate-200 hover:border-slate-700"
          >
            Open console
          </Link>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-300">
        <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-2 py-1">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">CPU</div>
          <div className="font-semibold text-slate-100">{formatPercent(cpuPercent)}</div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-2 py-1">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Memory</div>
          <div className="font-semibold text-slate-100">{formatPercent(memoryPercent)}</div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-2 py-1">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Disk</div>
          <div className="font-semibold text-slate-100">
            {server.diskUsageMb != null && diskTotalMb
              ? `${server.diskUsageMb} / ${diskTotalMb} MB (${formatPercent(diskPercent)})`
              : formatPercent(diskPercent)}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ServerCard;
