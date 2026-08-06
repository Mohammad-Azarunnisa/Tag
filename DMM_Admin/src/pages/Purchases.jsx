import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ShoppingBag, Plus, Pencil, Trash2, AlertTriangle } from 'lucide-react';
import { purchaseApi } from '../api/endpoints.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import OrgPicker from '../components/OrgPicker.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Card, Input, Select, Skeleton, EmptyState } from '../components/ui/primitives.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { formatDate } from '../lib/utils.js';

const CATEGORIES = ['Design', 'Stock', 'Video', 'Font', 'Tool', 'Other'];
const blank = { name: '', vendor: '', category: 'Design', seats: 1, cost: '', currency: 'INR', purchaseDate: '', expiryDate: '', notes: '' };

// Days until expiry → label + style
const expiryInfo = (d) => {
  if (!d) return null;
  const days = Math.ceil((new Date(d) - new Date()) / 86400000);
  if (days < 0) return { label: 'Expired', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300' };
  if (days <= 30) return { label: `${days}d left`, cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' };
  return { label: `${days}d left`, cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' };
};

export default function Purchases() {
  return (
    <div>
      <PageHeader title="Premium Packs & Purchases" subtitle="Track what the design/marketing team has purchased — vendor, cost, and when it expires." />
      <OrgPicker>{(orgId) => <Inner orgId={orgId} />}</OrgPicker>
    </div>
  );
}

function Inner({ orgId }) {
  const qc = useQueryClient();
  const key = ['purchases', orgId];
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => purchaseApi.list() });
  const purchases = data?.purchases || [];
  const [modal, setModal] = useState(null);

  const removeMut = useMutation({
    mutationFn: (id) => purchaseApi.remove(id),
    onSuccess: () => { toast.success('Removed'); qc.invalidateQueries({ queryKey: key }); },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed'),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setModal({ type: 'create' })}><Plus className="h-4 w-4" /> Add purchase</Button>
      </div>

      {isLoading ? <Skeleton className="h-64" /> : purchases.length === 0 ? (
        <EmptyState icon={ShoppingBag} title="No purchases yet" description="Add premium packs, stock subscriptions or tools the team has bought."
          action={<Button size="sm" onClick={() => setModal({ type: 'create' })}><Plus className="h-4 w-4" /> Add purchase</Button>} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-left text-xs uppercase text-slate-400">
                <th className="px-5 py-3 font-semibold">Item</th>
                <th className="px-5 py-3 font-semibold">Category</th>
                <th className="px-5 py-3 font-semibold">Seats</th>
                <th className="px-5 py-3 font-semibold">Cost</th>
                <th className="px-5 py-3 font-semibold">Purchased</th>
                <th className="px-5 py-3 font-semibold">Expires</th>
                <th className="px-5 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
              {purchases.map((p) => {
                const exp = expiryInfo(p.expiryDate);
                return (
                  <tr key={p._id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                    <td className="px-5 py-3">
                      <p className="font-semibold text-slate-700 dark:text-slate-200">{p.name}</p>
                      {p.vendor && <p className="text-xs text-slate-400">{p.vendor}</p>}
                    </td>
                    <td className="px-5 py-3 text-slate-600 dark:text-slate-300">{p.category}</td>
                    <td className="px-5 py-3 text-slate-600 dark:text-slate-300">{p.seats}</td>
                    <td className="px-5 py-3 text-slate-600 dark:text-slate-300">{p.cost ? `${p.currency} ${p.cost.toLocaleString()}` : '—'}</td>
                    <td className="px-5 py-3 text-slate-500">{p.purchaseDate ? formatDate(p.purchaseDate) : '—'}</td>
                    <td className="px-5 py-3">
                      {p.expiryDate ? (
                        <span className="inline-flex items-center gap-1">
                          <span className="text-slate-500">{formatDate(p.expiryDate)}</span>
                          {exp && <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${exp.cls}`}>{exp.label}</span>}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="inline-flex gap-1">
                        <button onClick={() => setModal({ type: 'edit', item: p })} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand-600 dark:hover:bg-slate-800"><Pencil className="h-4 w-4" /></button>
                        <button onClick={() => window.confirm(`Remove "${p.name}"?`) && removeMut.mutate(p._id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {modal && <PurchaseModal item={modal.item} onClose={() => setModal(null)} onSaved={() => { setModal(null); qc.invalidateQueries({ queryKey: key }); }} />}
    </div>
  );
}

function PurchaseModal({ item, onClose, onSaved }) {
  const [form, setForm] = useState(item
    ? { ...blank, ...item, purchaseDate: item.purchaseDate?.slice(0, 10) || '', expiryDate: item.expiryDate?.slice(0, 10) || '' }
    : blank);
  const [loading, setLoading] = useState(false);
  const set = (k, v) => setForm({ ...form, [k]: v });

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    setLoading(true);
    try {
      if (item) await purchaseApi.update(item._id, form);
      else await purchaseApi.create(form);
      toast.success('Saved'); onSaved();
    } catch (err) { toast.error(err.response?.data?.message || 'Save failed'); }
    finally { setLoading(false); }
  };

  return (
    <Modal open onClose={onClose} title={item ? 'Edit purchase' : 'Add purchase'}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Input label="Item name" required value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Envato Elements" />
          <Input label="Vendor" value={form.vendor} onChange={(e) => set('vendor', e.target.value)} placeholder="e.g. Envato" />
          <Select label="Category" value={form.category} onChange={(e) => set('category', e.target.value)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Input label="Seats / licenses" type="number" min="1" value={form.seats} onChange={(e) => set('seats', e.target.value)} />
          <Input label="Cost" type="number" min="0" value={form.cost} onChange={(e) => set('cost', e.target.value)} placeholder="0" />
          <Input label="Currency" value={form.currency} onChange={(e) => set('currency', e.target.value)} placeholder="INR" />
          <Input label="Purchased on" type="date" value={form.purchaseDate} onChange={(e) => set('purchaseDate', e.target.value)} />
          <Input label="Expires on" type="date" value={form.expiryDate} onChange={(e) => set('expiryDate', e.target.value)} />
        </div>
        <textarea className="input-base min-h-[60px]" placeholder="Notes (optional)" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" loading={loading}>Save</Button></div>
      </form>
    </Modal>
  );
}
