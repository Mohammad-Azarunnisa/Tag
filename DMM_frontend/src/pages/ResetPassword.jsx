import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Lock, ArrowLeft } from 'lucide-react';
import { authApi } from '../api/endpoints.js';
import { useAuthStore } from '../store/authStore.js';
import { Button } from '../components/ui/Button.jsx';
import { Input } from '../components/ui/primitives.jsx';

export default function ResetPassword() {
  const { token } = useParams();
  const navigate = useNavigate();
  const setUser = useAuthStore((s) => s.setUser);
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirm) { toast.error('Passwords do not match'); return; }
    if (form.password.length < 6) { toast.error('Password must be at least 6 characters'); return; }
    setLoading(true);
    try {
      await authApi.reset(token, form.password);
      toast.success('Password reset. Please sign in.');
      navigate('/login');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Reset failed — the link may be invalid or expired');
    } finally { setLoading(false); }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950 p-6">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 p-8 shadow-card">
        <Link to="/login" className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className="h-4 w-4" /> Back to login
        </Link>
        <h2 className="text-2xl font-extrabold text-slate-800 dark:text-white">Set a new password</h2>
        <p className="mt-2 text-sm text-slate-400">Choose a strong password you'll remember.</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div className="relative">
            <Lock className="absolute left-3 top-[38px] h-4 w-4 text-slate-400" />
            <Input label="New password" type="password" required className="pl-9"
              value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
          <div className="relative">
            <Lock className="absolute left-3 top-[38px] h-4 w-4 text-slate-400" />
            <Input label="Confirm password" type="password" required className="pl-9"
              value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
          </div>
          <Button type="submit" loading={loading} className="w-full">Reset password</Button>
        </form>
      </div>
    </div>
  );
}
