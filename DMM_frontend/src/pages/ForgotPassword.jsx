import { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Mail, CheckCircle2, Info } from 'lucide-react';
import { authApi } from '../api/endpoints.js';
import { Button } from '../components/ui/Button.jsx';
import { Input } from '../components/ui/primitives.jsx';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null); // { emailConfigured, message }

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await authApi.forgot(email);
      setResult({ emailConfigured: res.emailConfigured !== false, message: res.message });
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950 p-6">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 p-8 shadow-card">
        <Link to="/login" className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className="h-4 w-4" /> Back to login
        </Link>
        <h2 className="text-2xl font-extrabold text-slate-800 dark:text-white">Forgot password?</h2>
        <p className="mt-2 text-sm text-slate-400">Enter your email and we'll send you a reset link.</p>

        {result ? (
          <div className={`mt-6 flex items-start gap-3 rounded-xl p-4 text-sm ${result.emailConfigured ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400'}`}>
            {result.emailConfigured ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /> : <Info className="mt-0.5 h-5 w-5 shrink-0" />}
            <p>{result.message}</p>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <div className="relative">
              <Mail className="absolute left-3 top-[38px] h-4 w-4 text-slate-400" />
              <Input label="Email" type="email" required placeholder="you@yourcompany.com" className="pl-9"
                value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <Button type="submit" loading={loading} className="w-full">Send reset link</Button>
          </form>
        )}
      </div>
    </div>
  );
}
