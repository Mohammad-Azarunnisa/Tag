import { useState } from 'react';
import toast from 'react-hot-toast';
import {
  FileSpreadsheet, FileText, Download, CheckSquare, Send, FileImage, Images, Activity,
} from 'lucide-react';
import PageHeader from '../components/layout/PageHeader.jsx';
import { Card, Input } from '../components/ui/primitives.jsx';
import { Button } from '../components/ui/Button.jsx';
import { reportApi } from '../api/endpoints.js';
import api from '../api/client.js';

const REPORTS = [
  { type: 'approval', title: 'Approval Report', desc: 'All approval requests with status and timeline.', icon: CheckSquare, tone: 'bg-brand-50 dark:bg-brand-500/10 text-brand-600' },
  { type: 'posting', title: 'Posting Report', desc: 'Content marked as posted, by platform.', icon: Send, tone: 'bg-violet-50 dark:bg-violet-500/10 text-violet-600' },
  { type: 'template', title: 'Template Report', desc: 'Template library with download counts.', icon: FileImage, tone: 'bg-sky-50 dark:bg-sky-500/10 text-sky-600' },
  { type: 'asset', title: 'Asset Report', desc: 'Brand assets inventory and usage.', icon: Images, tone: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600' },
  { type: 'activity', title: 'User Activity Report', desc: 'Recent actions across the platform.', icon: Activity, tone: 'bg-amber-50 dark:bg-amber-500/10 text-amber-600' },
];

export default function Reports() {
  const [busy, setBusy] = useState(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const rangeReady = Boolean(from && to);

  // Download via authed axios so the JWT header is sent, then save the blob.
  const download = async (type, format) => {
    if (!rangeReady) {
      toast.error('Choose a start and end date first');
      return;
    }
    setBusy(`${type}-${format}`);
    try {
      const res = await api.get(reportApi.downloadUrl(type, format, from, to).replace('/api', ''), { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${type}-report-${from}-to-${to}.${format === 'excel' ? 'xlsx' : 'pdf'}`;
      a.click();
      window.URL.revokeObjectURL(url);
      toast.success('Report downloaded');
    } catch {
      toast.error('Export failed');
    } finally { setBusy(null); }
  };

  return (
    <div>
      <PageHeader title="Reports" subtitle="Choose a date range, then export the records from that period as Excel or PDF." />
      <Card className="mb-5 flex flex-wrap items-end gap-3 p-4">
        <Input label="From" type="date" className="sm:w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input label="To" type="date" className="sm:w-auto" min={from || undefined} value={to} onChange={(e) => setTo(e.target.value)} />
        <p className="pb-2 text-xs text-slate-400">Reports include records dated from the start date through the end date.</p>
      </Card>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((r) => {
          const Icon = r.icon;
          return (
            <Card key={r.type} className="flex flex-col p-5">
              <div className={`mb-4 w-fit rounded-xl p-3 ${r.tone}`}><Icon className="h-6 w-6" /></div>
              <h3 className="font-bold text-slate-800 dark:text-white">{r.title}</h3>
              <p className="mt-1 flex-1 text-sm text-slate-400">{r.desc}</p>
              <div className="mt-4 flex gap-2">
                <Button variant="secondary" size="sm" className="flex-1" disabled={!rangeReady} loading={busy === `${r.type}-excel`} onClick={() => download(r.type, 'excel')}>
                  <FileSpreadsheet className="h-4 w-4" /> Excel
                </Button>
                <Button variant="secondary" size="sm" className="flex-1" disabled={!rangeReady} loading={busy === `${r.type}-pdf`} onClick={() => download(r.type, 'pdf')}>
                  <FileText className="h-4 w-4" /> PDF
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
