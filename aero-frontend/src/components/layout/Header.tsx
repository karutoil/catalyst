import { Link } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';

function Header() {
  const { user, logout } = useAuthStore();
  const { toggleSidebar, sidebarCollapsed } = useUIStore();

  return (
    <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900/80 px-6 py-4 backdrop-blur">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggleSidebar}
          className="rounded-md border border-slate-800 bg-slate-900 px-3 py-1 text-xs font-semibold text-slate-200 shadow hover:border-slate-700"
        >
          {sidebarCollapsed ? 'Expand' : 'Collapse'}
        </button>
        <Link to="/dashboard" className="text-lg font-semibold text-sky-200">
          Aero Control
        </Link>
      </div>
      <div className="flex items-center gap-4 text-sm text-slate-200">
        <span>{user?.email ?? 'demo@aero.local'}</span>
        <button
          type="button"
          onClick={logout}
          className="rounded-md bg-sky-600 px-3 py-1 text-xs font-semibold text-white shadow hover:bg-sky-500"
        >
          Logout
        </button>
      </div>
    </header>
  );
}

export default Header;
