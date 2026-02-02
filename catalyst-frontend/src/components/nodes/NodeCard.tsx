import { Link } from 'react-router-dom';
import type { NodeInfo } from '../../types/node';
import NodeStatusBadge from './NodeStatusBadge';

function NodeCard({ node }: { node: NodeInfo }) {
  const lastSeen = node.lastSeenAt ? new Date(node.lastSeenAt).toLocaleString() : 'n/a';
  const serverCount = node._count?.servers ?? node.servers?.length ?? 0;

  return (
    <div className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-surface-light transition-all duration-300 hover:-translate-y-1 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:shadow-surface-dark dark:hover:border-primary-500/30">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/admin/nodes/${node.id}`}
              className="text-lg font-semibold text-slate-900 transition-all duration-300 hover:text-primary-600 dark:text-white dark:hover:text-primary-400"
            >
              {node.name}
            </Link>
            <NodeStatusBadge isOnline={node.isOnline} />
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-600 dark:text-slate-300">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 dark:border-slate-800 dark:bg-slate-950/60">
              {node.hostname ?? 'hostname n/a'}
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 dark:border-slate-800 dark:bg-slate-950/60">
              Last seen: {lastSeen}
            </span>
          </div>
        </div>
        <Link
          to={`/admin/nodes/${node.id}`}
          className="rounded-full border border-slate-200 bg-white px-4 py-1 text-xs font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500/30"
        >
          Manage
        </Link>
      </div>
      <div className="mt-4 grid gap-3 text-xs text-slate-600 dark:text-slate-300 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 shadow-surface-light transition-all duration-300 group-hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:shadow-surface-dark dark:group-hover:border-primary-500/30">
          <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-500">
            Servers
          </div>
          <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
            {serverCount}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 shadow-surface-light transition-all duration-300 group-hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:shadow-surface-dark dark:group-hover:border-primary-500/30">
          <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-500">
            CPU cores
          </div>
          <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
            {node.maxCpuCores ?? 0}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 shadow-surface-light transition-all duration-300 group-hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:shadow-surface-dark dark:group-hover:border-primary-500/30">
          <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-500">
            Memory
          </div>
          <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
            {node.maxMemoryMb ?? 0} MB
          </div>
        </div>
      </div>
    </div>
  );
}

export default NodeCard;
