import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore.js';

// Admin portal: every protected route requires an authenticated ADMIN.
export default function ProtectedRoute({ children }) {
  const { user, token } = useAuthStore();
  if (!token || !user) return <Navigate to="/login" replace />;
  if (user.role !== 'ADMIN') return <Navigate to="/login" replace />;
  return children;
}
