import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { RefreshCw, Plug, CheckCircle2, AlertTriangle, Link2, Sparkles, Instagram, Facebook } from 'lucide-react';
import { metaApi } from '../api/endpoints.js';
import { useAuthStore } from '../store/authStore.js';
import { Button } from './ui/Button.jsx';
import { Modal } from './ui/Modal.jsx';
import { Card } from './ui/primitives.jsx';
import { cn, formatDate, formatNumber } from '../lib/utils.js';

// Labels for the fields Meta can write, used until the report payload loads.
const FALLBACK_LABELS = {
  followers: 'Total Followers', newFollowers: 'New Followers',
  interactions: 'Interactions', visits: 'Visits',
};

const PillConnected = () => (
  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400"><CheckCircle2 className="h-3 w-3" />Connected</span>
);
const PillWarn = () => (
  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-600 dark:bg-amber-500/10 dark:text-amber-400"><AlertTriangle className="h-3 w-3" />Check token</span>
);
const PillOff = () => (
  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400"><Plug className="h-3 w-3" />Not connected</span>
);

// Live Instagram/Facebook sync from Meta. Shown above the report for those two
// platforms. The master token never reaches this component — it only calls the
// backend, which reads the token from its environment.
export default function MetaSync({ orgId, platform, report, onSynced }) {
  const { user: me } = useAuthStore();
  const [setupOpen, setSetupOpen] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const { data: status, isLoading } = useQuery({ queryKey: ['meta', 'status'], queryFn: metaApi.status, staleTime: 60_000, retry: false });

  const connected = status?.connected;
  const configured = status?.configured;
  const labels = report?.labels || FALLBACK_LABELS;

  // The component instance is reused across Instagram <-> Facebook — a sync
  // result belongs to one org + platform, so clear it when either changes.
  useEffect(() => { setLastSync(null); }, [orgId, platform]);

  const syncMut = useMutation({
    mutationFn: () => metaApi.sync(orgId, platform),
    onSuccess: (res) => {
      setLastSync(res);
      const w = res.written?.find((x) => x.platform === platform) || res.written?.[0];
      if (w) {
        toast.success(`Synced ${platform} from Meta — ${w.fields.length} live metric${w.fields.length === 1 ? '' : 's'} updated`);
        onSynced?.();
      } else {
        const reason = res.skipped?.find((s) => s.platform === platform)?.reason || res.skipped?.[0]?.reason || 'Nothing was synced.';
        toast.error(reason);
        if (/no .* linked/i.test(reason) && me?.isSuperAdmin) setSetupOpen(true);
      }
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Meta sync failed'),
  });

  const Icon = platform === 'Instagram' ? Instagram : Facebook;

  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="flex items-center gap-3">
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', connected ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-slate-100 text-slate-400 dark:bg-slate-800')}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-white">
            Meta auto-sync
            {!isLoading && (connected ? <PillConnected /> : configured ? <PillWarn /> : <PillOff />)}
          </p>
          <p className="mt-0.5 max-w-xl text-xs text-slate-400">
            {isLoading ? 'Checking Meta connection…'
              : connected ? `${status.pages} page${status.pages === 1 ? '' : 's'} · ${status.instagram} Instagram account${status.instagram === 1 ? '' : 's'} visible${status.missingScopes?.length ? ` · ⚠ missing scope: ${status.missingScopes.join(', ')}` : ''}`
              : configured ? (status.message || 'Token present but not usable.')
              : 'Add META_SYSTEM_TOKEN to the backend .env to pull Instagram & Facebook automatically.'}
          </p>
          {report?.latest?.date && (
            <p className="mt-0.5 text-[11px] text-slate-400">Data through {formatDate(report.latest.date)}</p>
          )}
          {platform === 'Facebook' && (
            <p className="mt-0.5 max-w-xl text-[11px] text-slate-400">
              Facebook metrics now use both Page insights and recent post insights when Meta exposes them. If some fields stay blank, confirm the token also has pages_read_user_content.
            </p>
          )}
          {platform === 'Instagram' && (
            <p className="mt-0.5 max-w-xl text-[11px] text-slate-400">
              Instagram sync now attempts impressions, profile views and link clicks in addition to followers, reach, views and interactions when Meta exposes them for the linked account.
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {connected && me?.isSuperAdmin && (
          <Button size="sm" variant="outline" onClick={() => setSetupOpen(true)}><Link2 className="h-4 w-4" /> Link accounts</Button>
        )}
        <Button size="sm" disabled={!connected} loading={syncMut.isPending} onClick={() => syncMut.mutate()} title={connected ? 'Pull live metrics from Meta' : 'Connect Meta first'}>
          <RefreshCw className="h-4 w-4" /> Sync from Meta
        </Button>
      </div>

      {/* What the last sync actually landed: one chip per written field, plus any skip reasons. */}
      {lastSync && (lastSync.written?.length > 0 || lastSync.skipped?.length > 0) && (
        <div className="w-full space-y-1.5 border-t border-slate-100 pt-3 dark:border-slate-800">
          {(lastSync.written || []).map((w) => (
            <div key={w.platform} className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Last sync wrote:</span>
              {(w.fields || []).map((f) => (
                <span key={f} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
                  {labels[f] || f}: {formatNumber(w.metrics?.[f])}
                </span>
              ))}
            </div>
          ))}
          {(lastSync.skipped || []).map((s, i) => (
            <p key={s.platform || i} className="flex items-start gap-1 text-[11px] text-amber-600 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {s.platform ? `${s.platform}: ` : ''}{s.reason}
            </p>
          ))}
        </div>
      )}

      {setupOpen && <MetaSetupModal open={setupOpen} onClose={() => setSetupOpen(false)} />}
    </Card>
  );
}

// Super-admin tool: map each organization to one of the Meta pages/IG accounts
// the token can see. Includes a one-click auto-match by name.
function MetaSetupModal({ open, onClose }) {
  const { data, isLoading, refetch, isError, error } = useQuery({ queryKey: ['meta', 'accounts'], queryFn: metaApi.accounts, enabled: open, retry: false });

  const automap = useMutation({
    mutationFn: metaApi.automap,
    onSuccess: (r) => { toast.success(`Auto-linked ${r.count} organization${r.count === 1 ? '' : 's'} by name`); refetch(); },
    onError: (e) => toast.error(e.response?.data?.message || 'Auto-match failed'),
  });
  const mapMut = useMutation({
    mutationFn: ({ org, page }) => metaApi.map(org, page),
    onSuccess: () => { toast.success('Saved'); refetch(); },
    onError: (e) => toast.error(e.response?.data?.message || 'Could not save link'),
  });

  const accounts = data?.accounts || [];
  const orgs = data?.organizations || [];

  return (
    <Modal open={open} onClose={onClose} title="Link organizations to Meta accounts" size="lg">
      <div className="space-y-4">
        <div className="flex items-start gap-2.5 rounded-xl border border-brand-200/60 bg-brand-50 px-4 py-3 text-xs text-brand-700 dark:border-brand-500/20 dark:bg-brand-500/10 dark:text-brand-300">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Pick the Meta page for each organization. Linking a page also links its connected Instagram account, so a single choice powers both platforms. Use <b>Auto-match by name</b> to do all of them at once.</span>
        </div>

        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500 dark:text-slate-400">{accounts.length} Meta account{accounts.length === 1 ? '' : 's'} visible to the token</p>
          <Button size="sm" variant="outline" loading={automap.isPending} onClick={() => automap.mutate()}><Sparkles className="h-4 w-4" /> Auto-match by name</Button>
        </div>

        {isLoading ? (
          <p className="py-8 text-center text-sm text-slate-400">Loading Meta accounts…</p>
        ) : isError ? (
          <p className="py-8 text-center text-sm text-rose-500">{error?.response?.data?.message || 'Could not load Meta accounts.'}</p>
        ) : (
          <div className="max-h-[50vh] space-y-2 overflow-y-auto">
            {orgs.map((org) => (
              <div key={org._id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 p-3 dark:border-slate-800">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800 dark:text-white">{org.name}</p>
                  <p className="text-xs text-slate-400">
                    {org.metaPageId ? <>Linked → {org.metaPageName}{org.metaInstagramUsername ? ` · @${org.metaInstagramUsername}` : ''}</> : 'Not linked yet'}
                  </p>
                </div>
                <select
                  className="input-base h-9 w-56 cursor-pointer py-1 text-sm"
                  value={org.metaPageId || ''}
                  onChange={(e) => mapMut.mutate({ org: org._id, page: e.target.value })}
                >
                  <option value="">— Not linked —</option>
                  {accounts.map((a) => (
                    <option key={a.pageId} value={a.pageId}>
                      {a.pageName}{a.instagramUsername ? ` · @${a.instagramUsername}` : ' · (no IG)'}
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
