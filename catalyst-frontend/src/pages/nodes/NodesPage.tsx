import { useMemo } from 'react';
import NodeList from '../../components/nodes/NodeList';
import NodeCreateModal from '../../components/nodes/NodeCreateModal';
import EmptyState from '../../components/shared/EmptyState';
import { useNodes } from '../../hooks/useNodes';
import { useAuthStore } from '../../stores/authStore';

type Props = {
  hideHeader?: boolean;
};

function NodesPage({ hideHeader }: Props) {
  const { data: nodes = [], isLoading } = useNodes();
  const { user } = useAuthStore();
  const isAdmin = useMemo(
    () => user?.permissions?.includes('admin.read') || user?.permissions?.includes('*'),
    [user?.permissions],
  );

  const locationId = nodes[0]?.locationId ?? '';

  return (
    <div className={hideHeader ? '' : 'space-y-6'}>
      {!hideHeader ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-surface-light transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900/70 dark:shadow-surface-dark dark:hover:border-primary-500/30">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Nodes</h1>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Track connected infrastructure nodes.
              </p>
            </div>
            {isAdmin ? (
              <NodeCreateModal locationId={locationId} />
            ) : (
              <span className="text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500">
                Admin access required
              </span>
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-600 dark:text-slate-400">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 dark:border-slate-800 dark:bg-slate-950/60">
              {nodes.length} nodes detected
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 dark:border-slate-800 dark:bg-slate-950/60">
              {nodes.filter((node) => node.isOnline).length} online
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 dark:border-slate-800 dark:bg-slate-950/60">
              {nodes.filter((node) => !node.isOnline).length} offline
            </span>
          </div>
        </div>
      ) : null}
      {isLoading ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-slate-600 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500/30">
          Loading nodes...
        </div>
      ) : nodes.length ? (
        <NodeList nodes={nodes} />
      ) : (
        <EmptyState
          title="No nodes detected"
          description="Install the Catalyst agent and register nodes to begin."
          action={isAdmin ? <NodeCreateModal locationId={locationId} /> : null}
        />
      )}
    </div>
  );
}

export default NodesPage;
