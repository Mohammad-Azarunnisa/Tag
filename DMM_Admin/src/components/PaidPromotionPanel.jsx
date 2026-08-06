import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { BadgeIndianRupee, BarChart3, Link2, RefreshCw, Sparkles } from 'lucide-react';
import { metaApi } from '../api/endpoints.js';
import { Button } from './ui/Button.jsx';
import { Card, EmptyState, Skeleton } from './ui/primitives.jsx';
import { Modal } from './ui/Modal.jsx';
import { formatDate, formatNumber } from '../lib/utils.js';

const RANGE_OPTIONS = [7, 14, 30, 60, 90];

export default function PaidPromotionPanel({ orgId }) {
  const qc = useQueryClient();
  const [range, setRange] = useState(30);
  const [setupOpen, setSetupOpen] = useState(false);

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ['meta', 'ads', 'status'],
    queryFn: metaApi.adsStatus,
    staleTime: 60_000,
    retry: false,
  });

  const { data: report, isLoading: reportLoading } = useQuery({
    queryKey: ['meta', 'ads', 'report', orgId, range],
    queryFn: () => metaApi.adsReport(orgId, range),
    enabled: !!orgId,
  });

  const syncMut = useMutation({
    mutationFn: () => metaApi.adsSync(orgId),
    onSuccess: (res) => {
      toast.success(`Paid metrics synced (${res.written} day rows)`);
      qc.invalidateQueries({ queryKey: ['meta', 'ads', 'report', orgId] });
    },
    onError: (e) => {
      const msg = e.response?.data?.message || 'Meta Ads sync failed';
      toast.error(msg);
      if (/No Meta ad account linked/i.test(msg)) setSetupOpen(true);
    },
  });

  const totals = report?.totals;
  const cards = useMemo(() => {
    if (!totals) return [];
    return [
      { label: 'Spend', value: `${totals.currency || 'INR'} ${formatNumber(totals.spend || 0)}` },
      { label: 'Impressions', value: formatNumber(totals.impressions || 0) },
      { label: 'Reach', value: formatNumber(totals.reach || 0) },
      { label: 'Clicks', value: formatNumber(totals.clicks || 0) },
      { label: 'CTR', value: `${Number(totals.ctr || 0).toFixed(2)}%` },
      { label: 'CPC', value: `${totals.currency || 'INR'} ${Number(totals.cpc || 0).toFixed(2)}` },
      { label: 'CPM', value: `${totals.currency || 'INR'} ${Number(totals.cpm || 0).toFixed(2)}` },
    ];
  }, [totals]);

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="text-sm font-bold text-slate-800 dark:text-white">Meta Ads paid promotion</p>
          <p className="text-xs text-slate-400">
            {statusLoading
              ? 'Checking Meta Ads connection...'
              : status?.connected
                ? status.adAccounts > 0
                  ? `Connected · ${status.adAccounts} ad account${status.adAccounts === 1 ? '' : 's'} visible`
                  : 'Connected · no ad accounts visible to this token'
                : (status?.message || 'Meta Ads is not connected')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select className="input-base h-9 w-auto py-1 text-sm" value={range} onChange={(e) => setRange(Number(e.target.value))}>
            {RANGE_OPTIONS.map((n) => <option key={n} value={n}>Past {n} days</option>)}
          </select>
          <Button size="sm" variant="outline" onClick={() => setSetupOpen(true)}><Link2 className="h-4 w-4" /> Link ad account</Button>
          <Button size="sm" loading={syncMut.isPending} onClick={() => syncMut.mutate()}><RefreshCw className="h-4 w-4" /> Sync paid data</Button>
        </div>
      </Card>

      {reportLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : !totals ? (
        <EmptyState icon={BadgeIndianRupee} title="No paid data yet" description="Link an ad account and run sync to view spend and performance metrics." />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {cards.map((c) => (
              <Card key={c.label} className="p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{c.label}</p>
                <p className="mt-1 text-2xl font-extrabold text-slate-800 dark:text-white">{c.value}</p>
              </Card>
            ))}
          </div>

          <Card className="overflow-hidden">
            <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Daily paid promotion snapshots</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs font-bold uppercase tracking-wide text-slate-400 dark:border-slate-800">
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Spend</th>
                    <th className="px-4 py-3">Impressions</th>
                    <th className="px-4 py-3">Reach</th>
                    <th className="px-4 py-3">Clicks</th>
                    <th className="px-4 py-3">CTR</th>
                    <th className="px-4 py-3">CPC</th>
                    <th className="px-4 py-3">CPM</th>
                  </tr>
                </thead>
                <tbody>
                  {(report.series || []).slice().reverse().map((r, idx) => (
                    <tr key={`${r.date}-${idx}`} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                      <td className="px-4 py-3">{formatDate(r.date)}</td>
                      <td className="px-4 py-3">{totals.currency || 'INR'} {formatNumber(r.spend || 0)}</td>
                      <td className="px-4 py-3">{formatNumber(r.impressions || 0)}</td>
                      <td className="px-4 py-3">{formatNumber(r.reach || 0)}</td>
                      <td className="px-4 py-3">{formatNumber(r.clicks || 0)}</td>
                      <td className="px-4 py-3">{Number(r.ctr || 0).toFixed(2)}%</td>
                      <td className="px-4 py-3">{totals.currency || 'INR'} {Number(r.cpc || 0).toFixed(2)}</td>
                      <td className="px-4 py-3">{totals.currency || 'INR'} {Number(r.cpm || 0).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {setupOpen && <MetaAdsSetupModal open={setupOpen} onClose={() => setSetupOpen(false)} />}
    </div>
  );
}

function MetaAdsSetupModal({ open, onClose }) {
  const { data, isLoading, refetch, isError, error } = useQuery({
    queryKey: ['meta', 'ads', 'accounts'],
    queryFn: metaApi.adsAccounts,
    enabled: open,
    retry: false,
  });

  const mapMut = useMutation({
    mutationFn: ({ organizationId, adAccountId }) => metaApi.adsMap(organizationId, adAccountId),
    onSuccess: () => {
      toast.success('Ad account mapping saved');
      refetch();
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Could not save mapping'),
  });

  const accounts = data?.accounts || [];
  const orgs = data?.organizations || [];
  const noAccounts = !isLoading && !isError && accounts.length === 0;

  return (
    <Modal open={open} onClose={onClose} title="Link organizations to Meta Ad Accounts" size="lg">
      <div className="space-y-4">
        <div className="flex items-start gap-2.5 rounded-xl border border-brand-200/60 bg-brand-50 px-4 py-3 text-xs text-brand-700 dark:border-brand-500/20 dark:bg-brand-500/10 dark:text-brand-300">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Select one ad account per organization to enable paid promotion sync and reporting.</span>
        </div>

        {noAccounts && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            No ad accounts are visible for the current token. In Meta Business Settings, assign this system user/person to at least one ad account with Ads Read (or Manage Campaigns), then reopen this modal.
          </div>
        )}

        {isLoading ? (
          <p className="py-8 text-center text-sm text-slate-400">Loading ad accounts...</p>
        ) : isError ? (
          <p className="py-8 text-center text-sm text-rose-500">{error?.response?.data?.message || 'Could not load ad accounts.'}</p>
        ) : (
          <div className="max-h-[50vh] space-y-2 overflow-y-auto">
            {orgs.map((org) => (
              <div key={org._id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 p-3 dark:border-slate-800">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800 dark:text-white">{org.name}</p>
                  <p className="text-xs text-slate-400">
                    {org.metaAdAccountId ? `Linked -> ${org.metaAdAccountName || `act_${org.metaAdAccountId}`}` : 'Not linked yet'}
                  </p>
                </div>
                <select
                  className="input-base h-9 w-64 cursor-pointer py-1 text-sm"
                  value={org.metaAdAccountId || ''}
                  disabled={accounts.length === 0}
                  onChange={(e) => mapMut.mutate({ organizationId: org._id, adAccountId: e.target.value })}
                >
                  <option value="">— Not linked —</option>
                  {accounts.map((a) => (
                    <option key={a.accountId} value={a.accountId}>
                      {a.name} ({a.currency || 'NA'})
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
