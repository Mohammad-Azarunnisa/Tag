import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Sparkles, CheckCircle2, AlertTriangle, XCircle, Loader2, ClipboardCopy, Check } from 'lucide-react';
import { aiApi } from '../../api/endpoints.js';
import { Card } from '../ui/primitives.jsx';
import { cn } from '../../lib/utils.js';

const VERDICTS = {
  ready: { label: 'Ready to publish', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300', Icon: CheckCircle2 },
  minor: { label: 'Minor tweaks suggested', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300', Icon: AlertTriangle },
  needs_work: { label: 'Needs work before approval', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300', Icon: XCircle },
};
const CHECK_ICON = {
  good: { Icon: CheckCircle2, cls: 'text-emerald-500' },
  warn: { Icon: AlertTriangle, cls: 'text-amber-500' },
  fix: { Icon: XCircle, cls: 'text-rose-500' },
};

// A one-click pre-approval quality check on the post copy. Advisory only — it
// never changes the request; the approver still decides. Only rendered for the
// approver on a POST awaiting a decision.
export default function ReviewAssist({ approvalId }) {
  const { data: status } = useQuery({ queryKey: ['ai-status'], queryFn: aiApi.status, staleTime: 5 * 60 * 1000 });
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  const mut = useMutation({
    mutationFn: () => aiApi.review(approvalId),
    onSuccess: (data) => setResult(data),
    onError: (err) => toast.error(err.response?.data?.message || 'Could not run the review right now'),
  });

  if (!status?.configured) return null;

  const v = result && (VERDICTS[result.verdict] || VERDICTS.minor);
  const copyRevised = () => {
    navigator.clipboard?.writeText(result.revisedCaption).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-brand-50/70 to-transparent px-5 py-4 dark:border-slate-800 dark:from-brand-500/10">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-amber-500 text-white shadow-sm">
            <Sparkles className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-bold text-slate-800 dark:text-white">Tago pre-approval review</p>
            <p className="text-xs text-slate-400">A quick quality check on the copy before you decide</p>
          </div>
        </div>
        <button
          type="button" onClick={() => mut.mutate()} disabled={mut.isPending}
          className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-brand-600 to-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-105 disabled:opacity-70"
        >
          {mut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {mut.isPending ? 'Reviewing…' : result ? 'Review again' : 'Review with Tago'}
        </button>
      </div>

      {result && (
        <div className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold', v.cls)}>
              <v.Icon className="h-3.5 w-3.5" /> {v.label}
            </span>
          </div>
          {result.summary && <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{result.summary}</p>}

          {result.checks?.length > 0 && (
            <ul className="space-y-2">
              {result.checks.map((c, i) => {
                const ci = CHECK_ICON[c.status] || CHECK_ICON.warn;
                return (
                  <li key={i} className="flex items-start gap-2.5">
                    <ci.Icon className={cn('mt-0.5 h-4 w-4 shrink-0', ci.cls)} />
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      <span className="font-semibold text-slate-700 dark:text-slate-200">{c.area}:</span> {c.note}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}

          {result.suggestions?.length > 0 && (
            <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/50">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-brand-600 dark:text-brand-400">Suggested fixes</p>
              <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
                {result.suggestions.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}

          {result.revisedCaption && (
            <div className="rounded-xl border border-brand-200/70 bg-brand-50/40 p-4 dark:border-brand-500/25 dark:bg-brand-500/5">
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-wide text-brand-600 dark:text-brand-400">Suggested rewrite</p>
                <button type="button" onClick={copyRevised} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 transition hover:text-brand-600">
                  {copied ? <><Check className="h-3.5 w-3.5 text-emerald-500" /> Copied</> : <><ClipboardCopy className="h-3.5 w-3.5" /> Copy</>}
                </button>
              </div>
              <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{result.revisedCaption}</p>
            </div>
          )}

          <p className="text-[11px] text-slate-300 dark:text-slate-600">
            Tago reviews the text only — it can’t see the image or video, so confirm the visual yourself. Advice only; the decision is yours.
          </p>
        </div>
      )}
    </Card>
  );
}
