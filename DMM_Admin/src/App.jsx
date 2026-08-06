import { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore.js';
import { useThemeStore, applyTheme } from './store/themeStore.js';

import AppLayout from './components/layout/AppLayout.jsx';
import ProtectedRoute from './components/layout/ProtectedRoute.jsx';

import Login from './pages/Login.jsx';
import Overview from './pages/Overview.jsx';
import Organizations from './pages/Organizations.jsx';
import Users from './pages/Users.jsx';
import Approvals from './pages/Approvals.jsx';
import ApprovalDetail from './pages/ApprovalDetail.jsx';
import Analytics from './pages/Analytics.jsx';
import BrandLibrary from './pages/BrandLibrary.jsx';
import Templates from './pages/Templates.jsx';
import Assets from './pages/Assets.jsx';
import Events from './pages/Events.jsx';
import Signage from './pages/Signage.jsx';
import SocialAccounts from './pages/SocialAccounts.jsx';
import Websites from './pages/Websites.jsx';
import Purchases from './pages/Purchases.jsx';
import Goals from './pages/Goals.jsx';
import Planners from './pages/Planners.jsx';
import Assistant from './pages/Assistant.jsx';
import Calendar from './pages/Calendar.jsx';
import ActivityLogs from './pages/ActivityLogs.jsx';
import AssignedWork from './pages/AssignedWork.jsx';
import Requests from './pages/Requests.jsx';
import PeriodReport from './pages/PeriodReport.jsx';
import Notifications from './pages/Notifications.jsx';
import Settings from './pages/Settings.jsx';
import BrandingRegister from './pages/BrandingRegister.jsx';

export default function App() {
  const { token, fetchMe } = useAuthStore();
  const { theme } = useThemeStore();
  const [ready, setReady] = useState(false);

  useEffect(() => { applyTheme(theme); }, [theme]);

  useEffect(() => {
    (async () => {
      try {
        if (token) await fetchMe();
      } catch { /* backend unreachable */ }
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/setup" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<Login />} />

      <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Overview />} />
        <Route path="/organizations" element={<Organizations />} />
        <Route path="/users" element={<Users />} />
        <Route path="/approvals" element={<Approvals />} />
        <Route path="/approvals/:id" element={<ApprovalDetail />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/brand-library" element={<BrandLibrary />} />
        <Route path="/templates" element={<Templates />} />
        <Route path="/assets" element={<Assets />} />
        <Route path="/events" element={<Events />} />
        <Route path="/signage" element={<Signage />} />
        <Route path="/branding-register" element={<BrandingRegister />} />
        <Route path="/social-accounts" element={<SocialAccounts />} />
        <Route path="/websites" element={<Websites />} />
        <Route path="/purchases" element={<Purchases />} />
        <Route path="/goals" element={<Goals />} />
        <Route path="/planners" element={<Planners />} />
        <Route path="/assistant" element={<Assistant />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/assigned-work" element={<AssignedWork />} />
        <Route path="/requests" element={<Requests />} />
        <Route path="/reports" element={<PeriodReport />} />
        <Route path="/activity" element={<ActivityLogs />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/settings" element={<Settings />} />
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
