import React from 'react';
import { NavLink } from 'react-router-dom';
import { usePluginTabs } from '../../plugins/hooks';

const baseTabs = [
  { to: '/admin', label: 'Overview', end: true },
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/servers', label: 'Servers' },
  { to: '/admin/nodes', label: 'Nodes' },
  { to: '/admin/templates', label: 'Templates' },
  { to: '/admin/database', label: 'Database' },
  { to: '/admin/network', label: 'Network' },
  { to: '/admin/api-keys', label: 'API Keys' },
  { to: '/admin/system', label: 'System' },
  { to: '/admin/security', label: 'Security' },
  { to: '/admin/theme-settings', label: 'Theme' },
  { to: '/admin/plugins', label: 'Plugins' },
  { to: '/admin/alerts', label: 'Alerts' },
  { to: '/admin/audit-logs', label: 'Audit Logs' },
];

function AdminTabs() {
  const pluginTabs = usePluginTabs('admin');
  
  // Convert plugin tabs to route format
  const pluginRoutes = React.useMemo(() => 
    pluginTabs.map((tab) => ({
      to: `/admin/plugin/${tab.id}`,
      label: tab.label,
      end: false,
    })),
    [pluginTabs]
  );
  
  const allTabs = React.useMemo(() => 
    [...baseTabs, ...pluginRoutes],
    [pluginRoutes]
  );
  
  return (
    <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30">
      {allTabs.map((tab) => (
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
