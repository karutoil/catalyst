import { Link } from 'react-router-dom';
import AdminTabs from '../../components/admin/AdminTabs';
import EmptyState from '../../components/shared/EmptyState';
import { useAdminStats, useAuditLogs } from '../../hooks/useAdmin';

const adminSections = [
  {
    title: 'Users',
    description: 'Manage accounts, roles, and access.',
    to: '/admin/users',
  },
  {
    title: 'Servers',
    description: 'Audit and manage all servers.',
    to: '/admin/servers',
  },
  {
    title: 'Nodes',
    description: 'Monitor and register infrastructure nodes.',
    to: '/admin/nodes',
  },
  {
    title: 'Templates',
    description: 'Curate the templates catalog.',
    to: '/admin/templates',
  },
  {
    title: 'Customer Databases',
    description: 'Configure database hosts for customer provisioning.',
    to: '/admin/database',
  },
  {
    title: 'Networks',
    description: 'Allocate and manage IP pools.',
    to: '/admin/network',
  },
  {
    title: 'System',
    description: 'Review platform health and services.',
    to: '/admin/system',
  },
  {
    title: 'Security',
    description: 'Manage lockouts and rate limits.',
    to: '/admin/security',
  },
  {
    title: 'Alerts',
    description: 'Configure alert rules and resolve incidents.',
    to: '/admin/alerts',
  },
  {
    title: 'Audit Logs',
    description: 'Track privileged actions.',
    to: '/admin/audit-logs',
  },
];

function AdminDashboardPage() {
  const { data: stats } = useAdminStats();
  const { data: auditResponse, isLoading: auditLoading } = useAuditLogs({ page: 1, limit: 5 });
  const logs = auditResponse?.logs ?? [];

  return (
    <div className="space-y-6">
      <AdminTabs />
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Admin Dashboard</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Overview of administrative tools and recent activity.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { title: 'Users', value: stats?.users ?? 0 },
          { title: 'Servers', value: stats?.servers ?? 0 },
          { title: 'Nodes', value: stats?.nodes ?? 0 },
          { title: 'Active Servers', value: stats?.activeServers ?? 0 },
        ].map((card) => (
          <div
            key={card.title}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 px-4 py-4 shadow"
          >
            <div className="text-xs uppercase text-slate-500 dark:text-slate-500">{card.title}</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">{card.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {adminSections.map((section) => (
          <Link
            key={section.to}
            to={section.to}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/60 px-5 py-4 transition hover:border-slate-200 dark:border-slate-700 hover:bg-white dark:bg-slate-900/60"
          >
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">{section.title}</div>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{section.description}</p>
          </Link>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-950/60 dark:hover:border-primary-500/30">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Recent audit logs</h2>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Latest 5 actions across the platform.
            </p>
          </div>
          <Link
            to="/admin/audit-logs"
            className="text-xs font-semibold text-primary-600 transition-all duration-300 hover:text-primary-500 dark:text-primary-400 dark:hover:text-primary-300"
          >
            View all
          </Link>
        </div>
        {auditLoading ? (
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-6 text-sm text-slate-600 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500/30">
            Loading audit logs...
          </div>
        ) : logs.length ? (
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {logs.map((log) => (
              <div key={log.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">{log.action}</div>
                  <div className="text-xs text-slate-600 dark:text-slate-400">
                    {log.user?.username ?? log.user?.email ?? log.userId ?? 'Unknown user'} · {log.resource}
                  </div>
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-500">
                  {new Date(log.timestamp).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No audit activity yet"
            description="Audit events will appear once actions are recorded."
          />
        )}
      </div>
    </div>
  );
}

export default AdminDashboardPage;
