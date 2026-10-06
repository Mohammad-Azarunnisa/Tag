import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Download, ArrowLeft, FileWarning } from 'lucide-react';
import { periodReportApi, organizationApi } from '../../api/endpoints.js';
import { Modal } from '../ui/Modal.jsx';
import { Button } from '../ui/Button.jsx';
import { Input, Select } from '../ui/primitives.jsx';

// Same windows the report page itself offers, worded the way the export dialog
// asks for them ("Previous" rather than "Last").
const DATE_PRESETS = [
  { key: 'this-month', label: 'This Month' },
  { key: 'last-month', label: 'Previous Month' },
  { key: 'this-quarter', label: 'This Quarter' },
  { key: 'this-fortnight', label: 'This Fortnight' },
  { key: 'last-fortnight', label: 'Previous Fortnight' },
  { key: 'custom', label: 'Custom Date Range' },
];

// Mirrors the backend's PLATFORMS constant (config/constants.js) — kept local
// because every other page in this app that offers a platform picker does the
// same rather than importing a shared list.
const SOCIAL_PLATFORMS = ['LinkedIn', 'Instagram', 'YouTube', 'Facebook'];

// An error response arrives as a Blob (not parsed JSON) whenever the request
// was made with responseType: 'blob', which axios does regardless of whether
// the response body is actually a PDF or a JSON error — unwrap it here so the
// real message ("No B&M report data is available…") reaches the user instead
// of a generic failure.
const readErrorMessage = async (err) => {
  const data = err?.response?.data;
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    try {
      const json = JSON.parse(await data.text());
      if (json?.message) return json.message;
    } catch {
      // Not JSON after all — fall through to the generic message below.
    }
  }
  return err?.response?.data?.message || 'Could not generate the PDF.';
};

const initialState = {
  preset: 'this-month',
  from: '',
  to: '',
  organizationId: '',
  platform: '',
};

/**
 * The "Download B&M Report" PDF export flow: its own Date Range / Organisation
 * / Social Media filters (independent of whatever the report page currently
 * shows), a dedicated pdfkit-rendered report (never an Excel conversion), and
 * an in-app preview before anything is saved to disk.
 */
export function BmReportPdfModal({ open, onClose }) {
  const [step, setStep] = useState('config');
  const [filters, setFilters] = useState(initialState);
  const [generating, setGenerating] = useState(false);
  const [formError, setFormError] = useState('');
  const [pdf, setPdf] = useState(null); // { url, filename }

  const { data: orgData } = useQuery({
    queryKey: ['bm-pdf-orgs'],
    queryFn: () => organizationApi.options({ scope: 'mine' }),
    enabled: open,
    staleTime: 60_000,
  });
  const organizations = orgData?.organizations || [];

  // Reset everything once the dialog is fully closed, so re-opening it never
  // shows a stale preview or a previous run's filters.
  useEffect(() => {
    if (open) return;
    if (pdf?.url) URL.revokeObjectURL(pdf.url);
    setStep('config');
    setFilters(initialState);
    setFormError('');
    setPdf(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = (patch) => setFilters((f) => ({ ...f, ...patch }));

  const buildQuery = () => {
    const q = {};
    if (filters.preset === 'custom') {
      if (!filters.from || !filters.to) return { error: 'Pick both a start and an end date.' };
      if (filters.from > filters.to) return { error: 'The start date cannot be after the end date.' };
      q.from = filters.from;
      q.to = filters.to;
    } else {
      q.preset = filters.preset;
    }
    if (filters.organizationId) q.organizationId = filters.organizationId;
    if (filters.platform) q.platform = filters.platform;
    return { query: q };
  };

  const generate = async () => {
    const { query, error } = buildQuery();
    if (error) { setFormError(error); return; }
    setFormError('');
    setGenerating(true);
    try {
      const { blob, filename } = await periodReportApi.exportPdf(query);
      if (pdf?.url) URL.revokeObjectURL(pdf.url);
      setPdf({ url: URL.createObjectURL(blob), filename });
      setStep('preview');
    } catch (err) {
      setFormError(await readErrorMessage(err));
    } finally {
      setGenerating(false);
    }
  };

  const download = () => {
    if (!pdf) return;
    const a = document.createElement('a');
    a.href = pdf.url;
    a.download = pdf.filename;
    a.click();
    toast.success('PDF downloaded');
  };

  const editFilters = () => setStep('config');

  return (
    <Modal open={open} onClose={onClose} size="lg"
      title={step === 'config' ? 'Download B&M Report' : 'Preview — B&M Report'}>
      {step === 'config' ? (
        <div className="space-y-5">
          <p className="text-sm text-slate-400">Select the filters for the PDF report.</p>

          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Date Range</p>
            <div className="flex flex-wrap gap-1.5">
              {DATE_PRESETS.map((p) => (
                <button key={p.key} type="button" onClick={() => set({ preset: p.key })}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                    filters.preset === p.key
                      ? 'border-transparent bg-brand-600 text-white shadow-soft'
                      : 'border-slate-200 text-slate-500 hover:border-brand-300 dark:border-slate-700 dark:text-slate-300'
                  }`}>
                  {p.label}
                </button>
              ))}
            </div>
            {filters.preset === 'custom' && (
              <div className="mt-3 flex flex-wrap gap-3">
                <Input label="Start date" type="date" value={filters.from} max={filters.to || undefined}
                  onChange={(e) => set({ from: e.target.value })} />
                <Input label="End date" type="date" value={filters.to} min={filters.from || undefined}
                  onChange={(e) => set({ to: e.target.value })} />
              </div>
            )}
          </div>

          <Select label="Organisation" value={filters.organizationId} onChange={(e) => set({ organizationId: e.target.value })}>
            <option value="">All Organisations</option>
            {organizations.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
          </Select>

          <Select label="Social Media" value={filters.platform} onChange={(e) => set({ platform: e.target.value })}>
            <option value="">All Social Media Accounts</option>
            {SOCIAL_PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>

          {formError && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/[0.08] dark:text-rose-300">
              <FileWarning className="mt-0.5 h-4 w-4 shrink-0" /> {formError}
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button loading={generating} disabled={generating} onClick={generate}>
              {generating ? 'Generating PDF…' : 'Generate PDF'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {pdf?.url && (
            <iframe title="B&M Report PDF preview" src={pdf.url} className="h-[70vh] w-full rounded-xl border border-slate-200 dark:border-slate-700" />
          )}
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
            <Button variant="outline" onClick={editFilters}><ArrowLeft className="h-4 w-4" /> Edit Filters</Button>
            <Button onClick={download}><Download className="h-4 w-4" /> Download PDF</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
