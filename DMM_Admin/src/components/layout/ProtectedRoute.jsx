import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore.js';

// Admin portal. Two kinds of account belong here:
//   ADMIN — the super admin, unrestricted across every institution.
//   CEO   — an institution Admin, who runs the colleges they hold and does the
//           same job inside them: see the users, assign work, approve content,
//           answer requests. Every endpoint they reach is already scoped to
//           their institutions server-side (utils/org.js#accessibleOrgIds), so
//           the console is safe for them; locking them out only meant they had
//           nowhere to do that job, since the product app has no such screens.
// Everyone else belongs in the product app.
export default function ProtectedRoute({ children }) {
  const { user, token } = useAuthStore();
  if (!token || !user) return <Navigate to="/login" replace />;
  if (!['ADMIN', 'CEO'].includes(user.role)) return <Navigate to="/login" replace />;
  return children;
}
