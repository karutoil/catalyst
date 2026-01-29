import { Link } from 'react-router-dom';
import type { NodeInfo } from '../../types/node';
import NodeStatusBadge from './NodeStatusBadge';

function NodeCard({ node }: { node: NodeInfo }) {
  const lastSeen = node.lastSeenAt ? new Date(node.lastSeenAt).toLocaleString() : 'n/a';
  const serverCount = node._count?.servers ?? node.servers?.length ?? 0;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-surface-light transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:shadow-surface-dark dark:hover:border-primary-500/30">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Link
              to={`/admin/nodes/${node.id}`}
              className="text-lg font-semibold text-slate-900 transition-all duration-300 hover:text-primary-600 dark:text-white dark:hover:text-primary-400"
            >
              {node.name}
            </Link>
            <NodeStatusBadge isOnline={node.isOnline} />
          </div>
          <div className="text-xs text-slate-600 dark:text-slate-400">
            {node.hostname ?? 'hostname n/a'}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500">
            Last seen: {lastSeen}
          </div>
        </div>
        <Link
          to={`/admin/nodes/${node.id}`}
          className="rounded-md border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500/30"
        >
          View
        </Link>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-slate-600 dark:text-slate-300">
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 shadow-surface-light transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:shadow-surface-dark dark:hover:border-primary-500/30">
          <div className="text-slate-500 dark:text-slate-400 dark:text-slate-500">Servers</div>
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {serverCount}
          </div>
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 shadow-surface-light transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:shadow-surface-dark dark:hover:border-primary-500/30">
          <div className="text-slate-500 dark:text-slate-400 dark:text-slate-500">Resources</div>
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {node.maxCpuCores ?? 0} CPU · {node.maxMemoryMb ?? 0} MB
          </div>
        </div>
      </div>
    </div>
  );
}

export default NodeCard;
