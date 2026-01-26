import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useNode, useNodeStats } from '../../hooks/useNodes';
import NodeStatusBadge from '../../components/nodes/NodeStatusBadge';
import NodeUpdateModal from '../../components/nodes/NodeUpdateModal';
import NodeDeleteDialog from '../../components/nodes/NodeDeleteDialog';
import NodeMetricsCard from '../../components/nodes/NodeMetricsCard';
import { useAuthStore } from '../../stores/authStore';

function NodeDetailsPage() {
  const { nodeId } = useParams();
  const { user } = useAuthStore();
  const { data: node, isLoading, isError } = useNode(nodeId);
  const { data: stats } = useNodeStats(nodeId);

  const isAdmin = useMemo(
    () => user?.permissions?.includes('admin.read') || user?.permissions?.includes('*'),
    [user?.permissions],
  );
  const lastSeen = node?.lastSeenAt ? new Date(node.lastSeenAt).toLocaleString() : 'n/a';
  const serverList = useMemo(() => node?.servers ?? [], [node]);

  if (isLoading) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-6 text-slate-200">
        Loading node...
      </div>
    );
  }

  if (isError || !node) {
    return (
      <div className="rounded-xl border border-rose-800 bg-rose-950/40 px-4 py-6 text-rose-200">
        Unable to load node details.
      </div>
    );
  }

  const resourceSummary = stats?.resources ?? null;
  const serverCount = stats?.servers.total ?? node._count?.servers ?? serverList.length;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold text-slate-50">{node.name}</h1>
              <NodeStatusBadge isOnline={node.isOnline} />
            </div>
            <div className="text-sm text-slate-400">
              {node.hostname ?? 'hostname n/a'} · {node.publicAddress ?? 'address n/a'}
            </div>
            <div className="text-xs text-slate-500">Last seen: {lastSeen}</div>
          </div>
          {isAdmin ? (
            <div className="flex flex-wrap gap-2 text-xs">
              <NodeUpdateModal node={node} />
              <NodeDeleteDialog nodeId={node.id} nodeName={node.name} />
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {stats ? <NodeMetricsCard stats={stats} /> : null}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4 lg:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-100">Capacity</div>
            <span className="text-xs text-slate-400">{serverCount} servers</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs text-slate-300">
            <div className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2">
              <div className="text-slate-400">CPU cores</div>
              <div className="text-sm font-semibold text-slate-100">{node.maxCpuCores ?? 0}</div>
              {resourceSummary ? (
                <div className="text-[11px] text-slate-500">
                  Allocated: {resourceSummary.allocatedCpuCores} · Available: {resourceSummary.availableCpuCores}
                </div>
              ) : null}
            </div>
            <div className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2">
              <div className="text-slate-400">Memory</div>
              <div className="text-sm font-semibold text-slate-100">{node.maxMemoryMb ?? 0} MB</div>
              {resourceSummary ? (
                <div className="text-[11px] text-slate-500">
                  Allocated: {resourceSummary.allocatedMemoryMb} · Available: {resourceSummary.availableMemoryMb}
                </div>
              ) : null}
            </div>
            <div className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2">
              <div className="text-slate-400">Disk</div>
              <div className="text-sm font-semibold text-slate-100">
                {resourceSummary ? `${resourceSummary.actualDiskUsageMb} / ${resourceSummary.actualDiskTotalMb} MB` : 'n/a'}
              </div>
            </div>
            <div className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2">
              <div className="text-slate-400">Uptime</div>
              <div className="text-sm font-semibold text-slate-100">{stats?.lastMetricsUpdate ? 'Active' : 'Unknown'}</div>
              <div className="text-[11px] text-slate-500">Metrics refresh every 30s</div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-100">Servers on node</h2>
          <Link to="/servers" className="text-xs font-medium text-sky-400 hover:text-sky-300">
            View all servers
          </Link>
        </div>
        {serverList.length ? (
          <ul className="space-y-2 text-sm text-slate-300">
            {serverList.map((server) => (
              <li
                key={server.id}
                className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-900 px-3 py-2"
              >
                <div>
                  <div className="text-slate-100">{server.name}</div>
                  <div className="text-xs text-slate-500">{server.status}</div>
                </div>
                <Link
                  to={`/servers/${server.id}`}
                  className="rounded-md border border-slate-800 px-2 py-1 text-xs text-slate-200 hover:border-slate-700"
                >
                  Open
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-sm text-slate-400">No servers assigned yet.</div>
        )}
      </div>
    </div>
  );
}

export default NodeDetailsPage;
