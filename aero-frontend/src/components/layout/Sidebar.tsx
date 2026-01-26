import { NavLink } from 'react-router-dom';
import { useUIStore } from '../../stores/uiStore';

const links = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/servers', label: 'Servers' },
  { to: '/tasks', label: 'Tasks' },
  { to: '/alerts', label: 'Alerts' },
  { to: '/admin/users', label: 'Admin' },
];

function Sidebar() {
  const { sidebarCollapsed } = useUIStore();
  return (
    <aside
      className={`border-r border-slate-800 bg-slate-900/80 px-2 py-6 text-sm transition-all ${
        sidebarCollapsed ? 'w-16' : 'w-56'
      }`}
    >
      <nav className="flex flex-col gap-2">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) =>
              `flex items-center rounded-md px-3 py-2 font-medium transition ${
                isActive ? 'bg-sky-600 text-white' : 'text-slate-200 hover:bg-slate-800'
              } ${sidebarCollapsed ? 'justify-center' : ''}`
            }
          >
            <span className="text-xs font-semibold uppercase text-slate-400">
              {sidebarCollapsed ? link.label[0] : ''}
            </span>
            <span className={`${sidebarCollapsed ? 'sr-only' : 'ml-2'}`}>{link.label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

export default Sidebar;
