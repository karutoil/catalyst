import { Link } from 'react-router-dom';
import type { Server } from '../../types/server';
import ServerStatusBadge from './ServerStatusBadge';
import ServerControls from './ServerControls';

function ServerCard({ server }: { server: Server }) {
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
        </div>
        <Link
          to={`/servers/${server.id}/console`}
          className="rounded-md border border-slate-800 bg-slate-900 px-3 py-1 text-xs font-semibold text-slate-200 hover:border-slate-700"
        >
          Open console
        </Link>
      </div>
      <div className="mt-3">
        <ServerControls serverId={server.id} status={server.status} />
      </div>
    </div>
  );
}

export default ServerCard;
