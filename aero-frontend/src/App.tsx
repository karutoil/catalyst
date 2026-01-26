import { Navigate, Route, Routes } from 'react-router-dom';
import AppLayout from './components/layout/AppLayout';
import ProtectedRoute from './components/auth/ProtectedRoute';
import { ToastProvider } from './components/providers/ToastProvider';
import { useAuthInit } from './hooks/useAuthInit';
import ErrorBoundary from './components/shared/ErrorBoundary';
import LoginPage from './pages/auth/LoginPage';
import RegisterPage from './pages/auth/RegisterPage';
import DashboardPage from './pages/dashboard/DashboardPage';
import ServersPage from './pages/servers/ServersPage';
import ServerDetailsPage from './pages/servers/ServerDetailsPage';
import NodeDetailsPage from './pages/nodes/NodeDetailsPage';
import TemplatesPage from './pages/templates/TemplatesPage';
import TemplateDetailsPage from './pages/templates/TemplateDetailsPage';
import AdminTemplatesPage from './pages/admin/TemplatesPage';
import AdminNodesPage from './pages/admin/NodesPage';
import TasksPage from './pages/tasks/TasksPage';
import AlertsPage from './pages/alerts/AlertsPage';
import UsersPage from './pages/admin/UsersPage';
import SystemPage from './pages/admin/SystemPage';
import AuditLogsPage from './pages/admin/AuditLogsPage';
import NotFoundPage from './pages/NotFoundPage';

function App() {
  useAuthInit();
  return (
    <ErrorBoundary>
      <ToastProvider />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
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
          <Route path="servers" element={<ServersPage />} />
          <Route path="servers/:serverId/:tab?" element={<ServerDetailsPage />} />
          <Route path="admin/nodes/:nodeId" element={<NodeDetailsPage />} />
          <Route path="admin/templates/:templateId" element={<TemplateDetailsPage />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="alerts" element={<AlertsPage />} />
          <Route path="admin/users" element={<UsersPage />} />
          <Route path="admin/nodes" element={<AdminNodesPage />} />
          <Route path="admin/templates" element={<AdminTemplatesPage />} />
          <Route path="admin/system" element={<SystemPage />} />
          <Route path="admin/audit-logs" element={<AuditLogsPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </ErrorBoundary>
  );
}

export default App;
