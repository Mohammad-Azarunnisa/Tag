import { ShieldAlert } from 'lucide-react';

// Shown when the platform has no users yet. The first admin account is created
// in the separate Admin portal (DMM_Admin), so we point there.
export default function NotConfigured() {
  const adminUrl = import.meta.env.VITE_ADMIN_URL || 'http://localhost:5174';
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950 p-6">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 p-8 text-center shadow-card">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-500/15">
          <ShieldAlert className="h-7 w-7 text-amber-600" />
        </div>
        <h1 className="text-xl font-extrabold text-slate-800 dark:text-white">Platform not configured yet</h1>
        <p className="mt-2 text-sm text-slate-400">
          No accounts exist yet. An administrator needs to complete the one-time
          setup in the Admin portal before you can sign in here.
        </p>
        <a href={adminUrl} className="mt-6 inline-flex items-center justify-center rounded-xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white hover:bg-brand-700">
          Open Admin portal
        </a>
      </div>
    </div>
  );
}
