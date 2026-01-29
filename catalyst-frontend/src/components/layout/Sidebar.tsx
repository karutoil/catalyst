import { NavLink } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';

const links = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/servers', label: 'Servers' },
  { to: '/admin', label: 'Admin', adminOnly: true },
];

function Sidebar() {
  const { sidebarCollapsed, theme, setTheme } = useUIStore();
  const { user } = useAuthStore();
  const isAdmin =
    user?.permissions?.includes('*') || user?.permissions?.includes('admin.read');
  return (
    <aside
      className={`flex flex-col border-r border-slate-800 bg-slate-900/80 px-2 py-6 text-sm transition-all ${
        sidebarCollapsed ? 'w-16' : 'w-56'
      }`}
    >
      <nav className="flex flex-1 flex-col gap-2">
        {links
          .filter((link) => (link.adminOnly ? isAdmin : true))
          .map((link) => (
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
      <div className="mt-6">
        <button
          type="button"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className={`w-full rounded-md border border-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-slate-700 hover:bg-slate-800 ${
            sidebarCollapsed ? 'px-2' : ''
          }`}
        >
          {sidebarCollapsed ? (theme === 'dark' ? '☀︎' : '☾') : `Theme: ${theme}`}
        </button>
      </div>
    </aside>
  );
}

export default Sidebar;
