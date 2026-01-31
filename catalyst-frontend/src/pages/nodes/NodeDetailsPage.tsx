import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useNode, useNodeStats } from '../../hooks/useNodes';
import NodeStatusBadge from '../../components/nodes/NodeStatusBadge';
import NodeUpdateModal from '../../components/nodes/NodeUpdateModal';
import NodeDeleteDialog from '../../components/nodes/NodeDeleteDialog';
import NodeMetricsCard from '../../components/nodes/NodeMetricsCard';
import { nodesApi } from '../../services/api/nodes';
import { useAuthStore } from '../../stores/authStore';
import { notifyError, notifySuccess } from '../../utils/notify';

function NodeDetailsPage() {
  const { nodeId } = useParams();
  const { user } = useAuthStore();
  const { data: node, isLoading, isError } = useNode(nodeId);
  const { data: stats } = useNodeStats(nodeId);
  const [deployInfo, setDeployInfo] = useState<{
    deployUrl: string;
    deploymentToken: string;
    secret: string;
    expiresAt: string;
  } | null>(null);

  const deployMutation = useMutation({
    mutationFn: async () => {
      if (!node?.id) {
        throw new Error('Missing node id');
      }
      return nodesApi.deploymentToken(node.id);
    },
    onSuccess: (info) => {
      setDeployInfo(info ?? null);
      notifySuccess('Deployment script regenerated');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to regenerate deployment script';
      notifyError(message);
    },
  });

  const isAdmin = useMemo(
    () => user?.permissions?.includes('admin.read') || user?.permissions?.includes('*'),
    [user?.permissions],
  );
  const lastSeen = node?.lastSeenAt ? new Date(node.lastSeenAt).toLocaleString() : 'n/a';
  const serverList = useMemo(() => node?.servers ?? [], [node]);

  if (isLoading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-slate-600 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500/30">
        Loading node...
      </div>
    );
  }

  if (isError || !node) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-100/60 px-4 py-6 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
        Unable to load node details.
      </div>
    );
  }

  const resourceSummary = stats?.resources ?? null;
  const serverCount = stats?.servers.total ?? node._count?.servers ?? serverList.length;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">
                {node.name}
              </h1>
              <NodeStatusBadge isOnline={node.isOnline} />
            </div>
            <div className="text-sm text-slate-600 dark:text-slate-400">
              {node.hostname ?? 'hostname n/a'} · {node.publicAddress ?? 'address n/a'}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500">Last seen: {lastSeen}</div>
          </div>
          {isAdmin ? (
            <div className="flex flex-wrap gap-2 text-xs">
              <button
                className="rounded-md border border-slate-200 px-3 py-1 font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 disabled:opacity-60 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => deployMutation.mutate()}
                disabled={deployMutation.isPending}
              >
                {deployMutation.isPending ? 'Generating...' : 'Regenerate deploy script'}
              </button>
              <NodeUpdateModal node={node} />
              <NodeDeleteDialog nodeId={node.id} nodeName={node.name} />
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {stats ? <NodeMetricsCard stats={stats} /> : null}
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30 lg:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-900 dark:text-white">Capacity</div>
            <span className="text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500">
              {serverCount} servers
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs text-slate-600 dark:text-slate-300">
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30">
              <div className="text-slate-500 dark:text-slate-400 dark:text-slate-500">CPU cores</div>
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {node.maxCpuCores ?? 0}
              </div>
              {resourceSummary ? (
                <div className="text-[11px] text-slate-500 dark:text-slate-400 dark:text-slate-500">
                  Allocated: {resourceSummary.allocatedCpuCores} · Available: {resourceSummary.availableCpuCores}
                </div>
              ) : null}
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30">
              <div className="text-slate-500 dark:text-slate-400 dark:text-slate-500">Memory</div>
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {node.maxMemoryMb ?? 0} MB
              </div>
              {resourceSummary ? (
                <div className="text-[11px] text-slate-500 dark:text-slate-400 dark:text-slate-500">
                  Allocated: {resourceSummary.allocatedMemoryMb} · Available: {resourceSummary.availableMemoryMb}
                </div>
              ) : null}
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30">
              <div className="text-slate-500 dark:text-slate-400 dark:text-slate-500">Disk</div>
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {resourceSummary ? `${resourceSummary.actualDiskUsageMb} / ${resourceSummary.actualDiskTotalMb} MB` : 'n/a'}
              </div>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30">
              <div className="text-slate-500 dark:text-slate-400 dark:text-slate-500">Uptime</div>
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {stats?.lastMetricsUpdate ? 'Active' : 'Unknown'}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 dark:text-slate-500">
                Metrics refresh every 30s
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Servers on node</h2>
          <Link
            to="/servers"
            className="text-xs font-medium text-primary-600 transition-all duration-300 hover:text-primary-500 dark:text-primary-400"
          >
            View all servers
          </Link>
          </div>
        {serverList.length ? (
          <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
            {serverList.map((server) => (
              <li
                key={server.id}
                className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30"
              >
                <div>
                  <div className="text-slate-900 dark:text-slate-100">{server.name}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500">
                    {server.status}
                  </div>
                </div>
                <Link
                  to={`/servers/${server.id}`}
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                >
                  Open
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-sm text-slate-600 dark:text-slate-400">
            No servers assigned yet.
          </div>
        )}
      </div>
      {deployInfo ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white dark:bg-slate-950/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white shadow-surface-light dark:shadow-surface-dark transition-all duration-300 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Deploy agent</h2>
              <button
                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setDeployInfo(null)}
              >
                Close
              </button>
            </div>
            <div className="space-y-3 px-6 py-4 text-sm text-slate-600 dark:text-slate-300">
              <div className="text-slate-600 dark:text-slate-300">
                Run this on the node to install and register the agent (valid for 24 hours).
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-100">
                <code className="whitespace-pre-wrap">
                  {`curl -s ${deployInfo.deployUrl} | sudo bash -x`}
                </code>
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500">
                Token expires: {new Date(deployInfo.expiresAt).toLocaleString()}
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4 text-xs dark:border-slate-800">
              <button
                className="rounded-md border border-slate-200 px-3 py-1 font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setDeployInfo(null)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default NodeDetailsPage;
