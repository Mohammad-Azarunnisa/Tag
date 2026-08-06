import { useQuery } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { ShoppingBag } from 'lucide-react';
import { libraryApi } from '../api/endpoints.js';
import { useAuthStore } from '../store/authStore.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import { Card, Skeleton, EmptyState } from '../components/ui/primitives.jsx';
import { formatDate } from '../lib/utils.js';

const expiryInfo = (d) => {
  if (!d) return null;
  const days = Math.ceil((new Date(d) - new Date()) / 86400000);
  if (days < 0) return { label: 'Expired', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300' };
  if (days <= 30) return { label: `${days}d left`, cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' };
  return { label: `${days}d left`, cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' };
};

export default function PremiumPacks() {
  const { user } = useAuthStore();
  const blocked = user && user.role !== 'CEO';
  const { data, isLoading } = useQuery({ queryKey: ['purchases'], queryFn: () => libraryApi.purchases(), enabled: !blocked });
  if (blocked) return <Navigate to="/dashboard" replace />;
  const purchases = data?.purchases || [];

  return (
    <div>
      <PageHeader title="Premium Packs & Tools" subtitle="Subscriptions and premium packs the team has purchased, and when they expire." />
      {isLoading ? <Skeleton className="h-64" /> : purchases.length === 0 ? (
        <EmptyState icon={ShoppingBag} title="Nothing listed yet" description="Your admin hasn't added any purchases for your organization." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-left text-xs uppercase text-slate-400">
                <th className="px-5 py-3 font-semibold">Item</th>
                <th className="px-5 py-3 font-semibold">Category</th>
                <th className="px-5 py-3 font-semibold">Seats</th>
                <th className="px-5 py-3 font-semibold">Purchased</th>
                <th className="px-5 py-3 font-semibold">Expires</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
              {purchases.map((p) => {
                const exp = expiryInfo(p.expiryDate);
                return (
                  <tr key={p._id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                    <td className="px-5 py-3"><p className="font-semibold text-slate-700 dark:text-slate-200">{p.name}</p>{p.vendor && <p className="text-xs text-slate-400">{p.vendor}</p>}</td>
                    <td className="px-5 py-3 text-slate-600 dark:text-slate-300">{p.category}</td>
                    <td className="px-5 py-3 text-slate-600 dark:text-slate-300">{p.seats}</td>
                    <td className="px-5 py-3 text-slate-500">{p.purchaseDate ? formatDate(p.purchaseDate) : '—'}</td>
                    <td className="px-5 py-3">{p.expiryDate ? <span className="inline-flex items-center gap-1"><span className="text-slate-500">{formatDate(p.expiryDate)}</span>{exp && <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${exp.cls}`}>{exp.label}</span>}</span> : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
