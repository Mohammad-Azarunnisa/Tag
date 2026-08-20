import { useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Eye, ArrowLeft } from 'lucide-react';
import Sidebar from './Sidebar.jsx';
import Topbar from './Topbar.jsx';
import { useAuthStore } from '../../store/authStore.js';

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user } = useAuthStore();
  const { state } = useLocation();
  const navigate = useNavigate();

  // Opening a notification sends you to the thing it is about, and until now
  // that was a one-way trip: the destination's own back link goes to its list
  // ("Back to approvals"), and the pages that are lists have no back link at
  // all — so working through a run of notifications meant finding the bell
  // again each time.
  //
  // The Notifications page tags the navigation with where it came from (see
  // pages/Notifications.jsx), and the way back is offered here rather than on
  // each destination: one strip in the layout covers every page a notification
  // can open, including the ones that are lists. The tag lives on that single
  // history entry, so it is gone as soon as you move on.
  const cameFrom = state?.from === '/notifications' ? state.from : null;

  return (
    <div className="min-h-screen">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="lg:pl-72">
        <Topbar onMenu={() => setSidebarOpen(true)} />
        {user?.viewOnly && (
          <div className="flex items-center justify-center gap-2 bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
            <Eye className="h-4 w-4 shrink-0" /> View-only access — you can see everything but can’t make changes.
          </div>
        )}
        {/* The page fills whatever screen it is opened on. The ceiling is there
            only so a very wide monitor doesn't stretch tables to the point of
            being hard to scan; every ordinary laptop and desktop is under it
            and gets the full width. */}
        <main className="mx-auto w-full max-w-[120rem] p-4 lg:p-6 2xl:px-8">
          {cameFrom && (
            <button onClick={() => navigate(cameFrom)}
              className="mb-4 inline-flex items-center gap-1.5 rounded-xl border border-brand-200 bg-brand-50 px-3 py-1.5 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-100 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300 dark:hover:bg-brand-500/20">
              <ArrowLeft className="h-4 w-4" /> Back to notifications
            </button>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
