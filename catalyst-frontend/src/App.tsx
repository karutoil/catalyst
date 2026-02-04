import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AppLayout from './components/layout/AppLayout';
import ProtectedRoute from './components/auth/ProtectedRoute';
import { ToastProvider } from './components/providers/ToastProvider';
import { useAuthInit } from './hooks/useAuthInit';
import ErrorBoundary from './components/shared/ErrorBoundary';
import { useUIStore } from './stores/uiStore';
import LoginPage from './pages/auth/LoginPage';
import RegisterPage from './pages/auth/RegisterPage';
import TwoFactorPage from './pages/auth/TwoFactorPage';
import DashboardPage from './pages/dashboard/DashboardPage';
import ServersPage from './pages/servers/ServersPage';
import ServerDetailsPage from './pages/servers/ServerDetailsPage';
import NodeDetailsPage from './pages/nodes/NodeDetailsPage';
import TemplatesPage from './pages/templates/TemplatesPage';
import TemplateDetailsPage from './pages/templates/TemplateDetailsPage';
import AdminTemplatesPage from './pages/admin/TemplatesPage';
import AdminNodesPage from './pages/admin/NodesPage';
import AdminServersPage from './pages/admin/ServersPage';
import AdminDashboardPage from './pages/admin/AdminDashboardPage';
import NetworkPage from './pages/admin/NetworkPage';
import DatabasePage from './pages/admin/DatabasePage';
import AdminAlertsPage from './pages/admin/AlertsPage';
import UsersPage from './pages/admin/UsersPage';
import SystemPage from './pages/admin/SystemPage';
import AuditLogsPage from './pages/admin/AuditLogsPage';
import SecurityPage from './pages/admin/SecurityPage';
import InvitesPage from './pages/InvitesPage';
import ProfilePage from './pages/ProfilePage';
import NotFoundPage from './pages/NotFoundPage';
import { ApiKeysPage } from './pages/ApiKeysPage';

function App() {
  useAuthInit();
  const { theme } = useUIStore();
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
  }, [theme]);
  return (
    <ErrorBoundary>
      <ToastProvider />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/two-factor" element={<TwoFactorPage />} />
        <Route path="/invites/:token" element={<InvitesPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="servers" element={<ServersPage />} />
          <Route path="servers/:serverId/:tab?" element={<ServerDetailsPage />} />
            <Route
              path="admin/nodes/:nodeId"
              element={
                <ProtectedRoute requireAdmin>
                  <NodeDetailsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="admin/templates/:templateId"
              element={
                <ProtectedRoute requireAdmin>
                  <TemplateDetailsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="admin"
              element={
                <ProtectedRoute requireAdmin>
                  <AdminDashboardPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="admin/users"
              element={
                <ProtectedRoute requireAdminWrite>
                  <UsersPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="admin/servers"
              element={
                <ProtectedRoute requireAdmin>
                  <AdminServersPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="admin/nodes"
              element={
                <ProtectedRoute requireAdmin>
                  <AdminNodesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="admin/templates"
              element={
                <ProtectedRoute requireAdmin>
                  <AdminTemplatesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="admin/database"
              element={
                <ProtectedRoute requireAdmin>
                  <DatabasePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="admin/network"
              element={
                <ProtectedRoute requireAdmin>
                  <NetworkPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="admin/system"
              element={
                <ProtectedRoute requireAdminWrite>
                  <SystemPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="admin/security"
              element={
                <ProtectedRoute requireAdminWrite>
                  <SecurityPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="admin/alerts"
              element={
                <ProtectedRoute requireAdmin>
                  <AdminAlertsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="admin/audit-logs"
              element={
                <ProtectedRoute requireAdmin>
                  <AuditLogsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="admin/api-keys"
              element={
                <ProtectedRoute requireAdmin>
                  <ApiKeysPage />
                </ProtectedRoute>
              }
            />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </ErrorBoundary>
  );
}

export default App;
