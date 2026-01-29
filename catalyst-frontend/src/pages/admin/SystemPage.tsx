import AdminTabs from '../../components/admin/AdminTabs';
import { useAdminHealth, useAdminStats } from '../../hooks/useAdmin';

function SystemPage() {
  const { data: stats } = useAdminStats();
  const { data: health } = useAdminHealth();

  return (
    <div className="space-y-4">
      <AdminTabs />
      <div>
        <h1 className="text-2xl font-semibold text-slate-50">System Health</h1>
        <p className="text-sm text-slate-400">Monitor global health and system statistics.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4">
          <div className="text-xs uppercase text-slate-500">Status</div>
          <div className="mt-2 text-lg font-semibold text-slate-100">
            {health?.status ?? 'loading'}
          </div>
          <div className="mt-1 text-xs text-slate-400">
            Database: {health?.database ?? 'checking'}
          </div>
          <div className="mt-1 text-xs text-slate-400">
            Checked {health ? new Date(health.timestamp).toLocaleTimeString() : '...'}
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4">
          <div className="text-xs uppercase text-slate-500">Nodes</div>
          <div className="mt-2 text-lg font-semibold text-slate-100">
            {health?.nodes.online ?? 0} online / {health?.nodes.total ?? 0}
          </div>
          <div className="mt-1 text-xs text-slate-400">
            Offline: {health?.nodes.offline ?? 0} · Stale: {health?.nodes.stale ?? 0}
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4">
          <div className="text-xs uppercase text-slate-500">System totals</div>
          <div className="mt-2 text-lg font-semibold text-slate-100">
            {stats?.servers ?? 0} servers
          </div>
          <div className="mt-1 text-xs text-slate-400">
            Users: {stats?.users ?? 0} · Active: {stats?.activeServers ?? 0}
          </div>
          <div className="mt-1 text-xs text-slate-400">Nodes: {stats?.nodes ?? 0}</div>
        </div>
      </div>
    </div>
  );
}

export default SystemPage;
