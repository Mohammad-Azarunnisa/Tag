import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore.js';

export default function ProtectedRoute({ children }) {
  const { user, token } = useAuthStore();
  if (!token || !user) return <Navigate to="/login" replace />;
  // Administrator accounts belong to the console, not here — the super admin and
  // institution Admins alike. Their work (users, assigned work, approvals,
  // college requests) only exists there, so letting them in would just show them
  // a college's screens with none of their own. A persisted session from before
  // this rule is rehydrated by zustand before fetchMe can clear it, so the route
  // turns it away too.
  if (['ADMIN', 'CEO'].includes(user.role)) return <Navigate to="/login" replace />;
  return children;
}
