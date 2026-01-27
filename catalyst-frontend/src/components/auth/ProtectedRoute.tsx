import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import LoadingSpinner from '../shared/LoadingSpinner';

type Props = {
  children: ReactNode;
  requireAdmin?: boolean;
};

function ProtectedRoute({ children, requireAdmin }: Props) {
  const location = useLocation();
  const { isAuthenticated, isReady, user } = useAuthStore();
  const hasAdminAccess =
    user?.permissions?.includes('*') || user?.permissions?.includes('admin.read');

  if (!isReady) {
    return <LoadingSpinner />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (requireAdmin && !hasAdminAccess) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}

export default ProtectedRoute;
