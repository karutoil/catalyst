import { Link } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';

function Header() {
  const { user, logout } = useAuthStore();
  const { toggleSidebar, sidebarCollapsed } = useUIStore();

  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4 shadow-surface-light transition-all duration-300 dark:border-slate-800 dark:bg-slate-900 dark:shadow-surface-dark">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggleSidebar}
          className="rounded-md border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-primary-500/30"
        >
          {sidebarCollapsed ? 'Expand' : 'Collapse'}
        </button>
        <Link to="/dashboard" className="flex items-center gap-2 text-lg font-semibold text-slate-900 transition-all duration-300 dark:text-white">
          <img src="/logo.png" alt="Catalyst logo" className="h-6 w-6" />
          Catalyst Control
        </Link>
      </div>
      <div className="flex items-center gap-4 text-sm text-slate-600 transition-all duration-300 dark:text-slate-300">
        <span className="font-medium">{user?.email ?? 'demo@catalyst.local'}</span>
        <button
          type="button"
          onClick={logout}
          className="rounded-md bg-primary-600 px-3 py-1 text-xs font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500"
        >
          Logout
        </button>
      </div>
    </header>
  );
}

export default Header;
