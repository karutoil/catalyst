import { Link } from 'react-router-dom';
import type { NodeInfo } from '../../types/node';
import NodeStatusBadge from './NodeStatusBadge';

function NodeCard({ node }: { node: NodeInfo }) {
  const lastSeen = node.lastSeenAt ? new Date(node.lastSeenAt).toLocaleString() : 'n/a';
  const serverCount = node._count?.servers ?? node.servers?.length ?? 0;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Link
              to={`/nodes/${node.id}`}
              className="text-lg font-semibold text-slate-50 hover:text-white"
            >
              {node.name}
            </Link>
            <NodeStatusBadge isOnline={node.isOnline} />
          </div>
          <div className="text-xs text-slate-400">{node.hostname ?? 'hostname n/a'}</div>
          <div className="text-xs text-slate-500">Last seen: {lastSeen}</div>
        </div>
        <Link
          to={`/nodes/${node.id}`}
          className="rounded-md border border-slate-800 bg-slate-900 px-3 py-1 text-xs font-semibold text-slate-200 hover:border-slate-700"
        >
          View
        </Link>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-slate-300">
        <div className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2">
          <div className="text-slate-400">Servers</div>
          <div className="text-sm font-semibold text-slate-100">{serverCount}</div>
        </div>
        <div className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2">
          <div className="text-slate-400">Resources</div>
          <div className="text-sm font-semibold text-slate-100">
            {node.maxCpuCores ?? 0} CPU · {node.maxMemoryMb ?? 0} MB
          </div>
        </div>
      </div>
    </div>
  );
}

export default NodeCard;
