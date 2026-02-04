import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import LoadingSpinner from '../shared/LoadingSpinner';

type Props = {
  children: ReactNode;
  requireAdmin?: boolean;
  requireAdminWrite?: boolean;
};

function ProtectedRoute({ children, requireAdmin, requireAdminWrite }: Props) {
  const location = useLocation();
  const { isAuthenticated, isReady, user } = useAuthStore();
  const hasAdminAccess =
    user?.permissions?.includes('*') ||
    user?.permissions?.includes('admin.write') ||
    user?.permissions?.includes('admin.read');
  const hasAdminWrite =
    user?.permissions?.includes('*') || user?.permissions?.includes('admin.write');

  if (!isReady) {
    return <LoadingSpinner />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (requireAdminWrite && !hasAdminWrite) {
    return <Navigate to="/dashboard" replace />;
  }

  if (requireAdmin && !hasAdminAccess) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}

export default ProtectedRoute;
