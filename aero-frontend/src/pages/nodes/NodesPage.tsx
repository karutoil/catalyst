import { useMemo } from 'react';
import NodeList from '../../components/nodes/NodeList';
import NodeCreateModal from '../../components/nodes/NodeCreateModal';
import EmptyState from '../../components/shared/EmptyState';
import { useNodes } from '../../hooks/useNodes';
import { useAuthStore } from '../../stores/authStore';

function NodesPage() {
  const { data: nodes = [], isLoading } = useNodes();
  const { user } = useAuthStore();
  const isAdmin = useMemo(
    () => user?.permissions?.includes('admin.read') || user?.permissions?.includes('*'),
    [user?.permissions],
  );

  const locationId = nodes[0]?.locationId ?? '';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-50">Nodes</h1>
          <p className="text-sm text-slate-400">Track connected infrastructure nodes.</p>
        </div>
        {isAdmin ? (
          <NodeCreateModal locationId={locationId} />
        ) : (
          <span className="text-xs text-slate-500">Admin access required</span>
        )}
      </div>
      {isLoading ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-6 text-slate-200">
          Loading nodes...
        </div>
      ) : nodes.length ? (
        <NodeList nodes={nodes} />
      ) : (
        <EmptyState
          title="No nodes detected"
          description="Install the Aero agent and register nodes to begin."
          action={isAdmin ? <NodeCreateModal locationId={locationId} /> : null}
        />
      )}
    </div>
  );
}

export default NodesPage;
