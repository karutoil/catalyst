import type { ServerStatus } from '../../types/server';

const colorMap: Record<ServerStatus, string> = {
  stopped: 'bg-slate-700 text-slate-100',
  installing: 'bg-sky-700 text-white',
  starting: 'bg-sky-600 text-white',
  running: 'bg-emerald-700 text-white',
  stopping: 'bg-amber-600 text-white',
  crashed: 'bg-rose-700 text-white',
  transferring: 'bg-purple-700 text-white',
};

function ServerStatusBadge({ status }: { status: ServerStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${colorMap[status]}`}>
      {status}
    </span>
  );
}

export default ServerStatusBadge;
