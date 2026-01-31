import { Link } from 'react-router-dom';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';

function Header() {
  const { user, logout } = useAuthStore();
  const { toggleSidebar, sidebarCollapsed } = useUIStore();

  const initials =
    user?.username?.slice(0, 2).toUpperCase() ||
    user?.email?.slice(0, 2).toUpperCase() ||
    'U';

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
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-xs font-semibold text-slate-700 shadow-sm transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-primary-500/30"
            >
              {initials}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={8} className="w-56">
            <div className="space-y-1">
              <div className="px-2 pb-2 pt-1 text-xs text-slate-500 dark:text-slate-400">
                {user?.email ?? 'demo@catalyst.local'}
              </div>
              <Link
                to="/profile"
                className="flex items-center rounded-md px-2 py-1.5 text-sm font-medium text-slate-700 transition-all duration-300 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Profile
              </Link>
              <button
                type="button"
                onClick={logout}
                className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm font-medium text-rose-600 transition-all duration-300 hover:bg-rose-50 dark:hover:bg-rose-500/10"
              >
                Logout
              </button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </header>
  );
}

export default Header;
