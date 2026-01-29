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
    <div className="flex flex-wrap gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs">
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            `rounded-full px-3 py-1.5 font-semibold transition ${
              isActive
                ? 'bg-sky-600 text-white'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
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
