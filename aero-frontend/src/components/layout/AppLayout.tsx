import { Outlet } from 'react-router-dom';
import Header from './Header';
import Sidebar from './Sidebar';
import Breadcrumbs from './Breadcrumbs';
import { useUIStore } from '../../stores/uiStore';
import { useWebSocketConnection } from '../../hooks/useWebSocketConnection';
import { useServerStateUpdates } from '../../hooks/useServerStateUpdates';

function AppLayout() {
  const { sidebarCollapsed } = useUIStore();
  useWebSocketConnection();
  useServerStateUpdates();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <Header />
      <div className="flex">
        <Sidebar />
        <main className={`flex-1 px-6 py-6 ${sidebarCollapsed ? 'pl-4' : 'pl-8'}`}>
          <div className="space-y-4">
            <Breadcrumbs />
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

export default AppLayout;
