import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Archive, Download, Eye, ChevronDown, ChevronUp, CheckCircle2, Clock } from 'lucide-react';
import { periodReportApi } from '../../api/endpoints.js';
import { Button } from '../ui/Button.jsx';
import { Card, Skeleton } from '../ui/primitives.jsx';
import { downloadBlob } from '../../lib/utils.js';

const RECENT = 3; // always shown; earlier months sit behind "Show earlier months"

const stamp = (iso) => new Date(iso).toLocaleString('en-IN', {
  day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
});
const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// A blob error body arrives unparsed when the request asked for a file.
const messageOf = async (err) => {
  const data = err?.response?.data;
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    try { const j = JSON.parse(await data.text()); if (j?.message) return j.message; } catch { /* not JSON */ }
  }
  return err?.response?.data?.message || 'Could not open that report.';
};

/**
 * The finished months' B&M reports, newest first. Each is built once (automatically on the 1st,
 * or the first time someone opens it) and stored, so every Admin opens and downloads the same
 * file rather than building it again. The last three months are always on show.
 */
export default function MonthlyReportsArchive() {
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(null); // `${month}:view|download`
  const { data, isLoading, refetch } = useQuery({ queryKey: ['monthly-reports'], queryFn: periodReportApi.monthlyList, staleTime: 60_000 });
  const months = data?.months || [];
  const shown = showAll ? months : months.slice(0, RECENT);

  const open = async (m, mode) => {
    // Open the tab now, while the click still counts as a user action; point it at the file once it arrives.
    const tab = mode === 'view' ? window.open('', '_blank') : null;
    setBusy(`${m.month}:${mode}`);
    try {
      const res = await periodReportApi.monthlyFile(m.month, mode === 'download');
      if (mode === 'download' || !tab) {
        downloadBlob(res.blob, res.filename);
        tab?.close();
        toast.success('Report downloaded');
      } else {
        tab.location.href = URL.createObjectURL(res.blob);
      }
      if (!m.stored) refetch(); // it was just built and stored
    } catch (err) {
      tab?.close();
      toast.error(await messageOf(err));
    } finally { setBusy(null); }
  };

  return (
    <Card className="mb-5 p-4">
      <div className="mb-3 flex items-start gap-3">
        <Archive className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-slate-800 dark:text-white">Monthly reports</h2>
          <p className="text-xs text-slate-400">
            Each finished month's report is built once and stored here, so everyone opens the same file. The last {RECENT} months are always available.
          </p>
        </div>
      </div>

      {isLoading ? <Skeleton className="h-32" /> : (
        <ul className="space-y-1.5">
          {shown.map((m) => (
            <li key={m.month} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-100 px-3 py-2.5 dark:border-slate-800">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-700 dark:text-slate-200">{m.label}</p>
                <p className="flex items-center gap-1 text-xs text-slate-400">
                  {m.stored
                    ? <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> Stored {stamp(m.generatedAt)}{m.automatic ? ' · automatic' : ''} · {kb(m.size)}</>
                    : <><Clock className="h-3.5 w-3.5" /> Not built yet — it is created and kept the first time it is opened</>}
                </p>
              </div>
              <Button size="sm" variant="outline" loading={busy === `${m.month}:view`} disabled={!!busy} onClick={() => open(m, 'view')}>
                <Eye className="h-3.5 w-3.5" /> View
              </Button>
              <Button size="sm" loading={busy === `${m.month}:download`} disabled={!!busy} onClick={() => open(m, 'download')}>
                <Download className="h-3.5 w-3.5" /> Download
              </Button>
            </li>
          ))}
        </ul>
      )}

      {months.length > RECENT && (
        <button type="button" onClick={() => setShowAll((v) => !v)}
          className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400">
          {showAll ? <><ChevronUp className="h-3.5 w-3.5" /> Show fewer</> : <><ChevronDown className="h-3.5 w-3.5" /> Show earlier months ({months.length - RECENT} more)</>}
        </button>
      )}
    </Card>
  );
}
