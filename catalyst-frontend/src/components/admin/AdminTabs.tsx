import { NavLink } from 'react-router-dom';

const tabs = [
  { to: '/admin', label: 'Overview', end: true },
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/servers', label: 'Servers' },
  { to: '/admin/nodes', label: 'Nodes' },
  { to: '/admin/templates', label: 'Templates' },
  { to: '/admin/database', label: 'Database' },
  { to: '/admin/network', label: 'Network' },
  { to: '/admin/system', label: 'System' },
  { to: '/admin/security', label: 'Security' },
  { to: '/admin/alerts', label: 'Alerts' },
  { to: '/admin/audit-logs', label: 'Audit Logs' },
];

function AdminTabs() {
  return (
    <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30">
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            `rounded-full px-3 py-1.5 font-semibold transition-all duration-300 ${
              isActive
                ? 'bg-primary-600 text-white shadow-lg shadow-primary-500/20'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
            }`
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </div>
  );
}

export default AdminTabs;
