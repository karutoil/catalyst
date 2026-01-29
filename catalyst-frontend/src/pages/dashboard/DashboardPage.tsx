import { Link } from 'react-router-dom';

const statCards = [
  { title: 'Servers', value: '12', delta: '+2 this week' },
  { title: 'Nodes', value: '3', delta: 'All online' },
  { title: 'Alerts', value: '1', delta: '1 acknowledged' },
];

const resourceStats = [
  { label: 'CPU Utilization', value: 42, color: 'bg-primary-500' },
  { label: 'Memory Utilization', value: 68, color: 'bg-emerald-500' },
  { label: 'Network Throughput', value: 37, color: 'bg-amber-500' },
];

const activities = [
  { title: 'Server started', detail: 'minecraft-01 on production-1', time: '2m ago' },
  { title: 'Backup completed', detail: 'valheim-02 • 1.2 GB', time: '18m ago' },
  { title: 'Node heartbeat', detail: 'production-1 healthy', time: '24m ago' },
];

function DashboardPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Dashboard</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            System overview and quick insights.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/servers"
            className="inline-flex items-center justify-center rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500"
          >
            Create Server
          </Link>
          <Link
            to="/admin/nodes"
            className="inline-flex items-center justify-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition-all duration-300 hover:bg-emerald-500"
          >
            Register Node
          </Link>
          <Link
            to="/admin/alerts"
            className="inline-flex items-center justify-center rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-amber-500/20 transition-all duration-300 hover:bg-amber-500"
          >
            View Alerts
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {statCards.map((card) => (
          <div
            key={card.title}
            className="rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30"
          >
            <div className="text-sm text-slate-600 dark:text-slate-400">{card.title}</div>
            <div className="text-3xl font-semibold text-slate-900 dark:text-white">{card.value}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">{card.delta}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                Resource usage
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-400">Across all nodes</p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              Live
            </span>
          </div>
          <div className="space-y-4">
            {resourceStats.map((stat) => (
              <div key={stat.label} className="space-y-2">
                <div className="flex items-center justify-between text-sm text-slate-600 dark:text-slate-300">
                  <span>{stat.label}</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {stat.value}%
                  </span>
                </div>
                <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-800">
                  <div
                    className={`h-2 rounded-full ${stat.color}`}
                    style={{ width: `${stat.value}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Recent activity
            </h2>
            <Link
              to="/admin/alerts"
              className="text-xs font-medium text-primary-600 transition-all duration-300 hover:text-primary-500 dark:text-primary-400 dark:hover:text-primary-300"
            >
              View all
            </Link>
          </div>
          <ul className="space-y-3">
            {activities.map((item) => (
              <li
                key={item.title}
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-600 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500/30"
              >
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {item.title}
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-400">{item.detail}</div>
                <div className="text-[11px] text-slate-500 dark:text-slate-500">{item.time}</div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export default DashboardPage;
