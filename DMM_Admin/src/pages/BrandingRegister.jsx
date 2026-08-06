import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { HardHat, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { brandingRegisterApi, signageApi } from '../api/endpoints.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Card, EmptyState, Input, Select, Skeleton } from '../components/ui/primitives.jsx';
import { Modal } from '../components/ui/Modal.jsx';

const CATEGORIES = [
  { value: 'FRAME', label: 'Frames' },
  { value: 'BANNER_BOARD', label: 'Banner Boards' },
  { value: 'EQUIPMENT', label: 'Branding Equipment' },
];

function colsFor(category) {
  if (category === 'FRAME') return ['Title', 'Size', 'Mapped Signage', 'Qty', 'Notes', ''];
  if (category === 'BANNER_BOARD') return ['Title', 'Size', 'Place', 'Mapped Signage', 'College', 'Board Serials', 'Qty', ''];
  return ['Title', 'Assigned To', 'Type', 'Specs', 'Renewal', 'Annual Cost', 'Qty', ''];
}

export default function BrandingRegister() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState({ category: 'FRAME', search: '' });
  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['branding-register', filters],
    queryFn: () => brandingRegisterApi.list(filters),
  });

  const { data: signageData } = useQuery({
    queryKey: ['signage-locations', 'register-mapping'],
    queryFn: () => signageApi.locations({}),
  });
  const signageLocations = signageData?.locations || [];

  const items = data?.items || [];
  const totals = data?.totals || { FRAME: 0, BANNER_BOARD: 0, EQUIPMENT: 0 };

  const removeMut = useMutation({
    mutationFn: (id) => brandingRegisterApi.remove(id),
    onSuccess: () => {
      toast.success('Item removed');
      qc.invalidateQueries({ queryKey: ['branding-register'] });
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Delete failed'),
  });

  const rows = useMemo(() => items.filter((x) => x.category === filters.category), [items, filters.category]);

  return (
    <div>
      <PageHeader
        title="Branding Register"
        subtitle="Frames, banner boards, and branding team equipment register for super admin"
        actions={
          <div className="flex gap-2">
            <Button onClick={() => setShowAdd(true)}><Plus className="h-4 w-4" /> Add Item</Button>
          </div>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {CATEGORIES.map((c) => (
          <Card key={c.value} className={`cursor-pointer p-4 transition ${filters.category === c.value ? 'ring-2 ring-brand-500/40' : ''}`} onClick={() => setFilters((prev) => ({ ...prev, category: c.value }))}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{c.label}</p>
            <p className="mt-1 text-2xl font-extrabold text-slate-800 dark:text-white">{totals[c.value] || 0}</p>
          </Card>
        ))}
      </div>

      <div className="mb-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" placeholder="Search in current register..." value={filters.search} onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))} />
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={HardHat} title="No register rows" description="Add rows manually using Add Item." action={<Button onClick={() => setShowAdd(true)}><Plus className="h-4 w-4" /> Add Item</Button>} />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-bold uppercase tracking-wide text-slate-400 dark:border-slate-800">
                  {colsFor(filters.category).map((c) => <th key={c} className="px-4 py-3">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r._id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                    <td className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">{r.title}</td>
                    {filters.category === 'FRAME' && (
                      <>
                        <td className="px-4 py-3">{r.size || '-'}</td>
                        <td className="px-4 py-3 text-slate-500">{r.signageLocation ? `${r.signageLocation.code} - ${r.signageLocation.place}` : '-'}</td>
                        <td className="px-4 py-3">{r.quantity || 0}</td>
                        <td className="px-4 py-3 text-slate-500">{r.notes || '-'}</td>
                      </>
                    )}
                    {filters.category === 'BANNER_BOARD' && (
                      <>
                        <td className="px-4 py-3">{r.size || '-'}</td>
                        <td className="px-4 py-3">{r.location || '-'}</td>
                        <td className="px-4 py-3 text-slate-500">{r.signageLocation ? `${r.signageLocation.code} - ${r.signageLocation.place}` : '-'}</td>
                        <td className="px-4 py-3">{r.organizationName || '-'}</td>
                        <td className="px-4 py-3">{r.serialCodes || '-'}</td>
                        <td className="px-4 py-3">{r.quantity || 0}</td>
                      </>
                    )}
                    {filters.category === 'EQUIPMENT' && (
                      <>
                        <td className="px-4 py-3">{r.assignedTo || '-'}</td>
                        <td className="px-4 py-3">{r.deviceType || '-'}</td>
                        <td className="px-4 py-3 max-w-[360px] truncate" title={r.specs || ''}>{r.specs || '-'}</td>
                        <td className="px-4 py-3">{r.renewalDate ? new Date(r.renewalDate).toLocaleDateString() : '-'}</td>
                        <td className="px-4 py-3">{r.annualCost ? `INR ${r.annualCost.toLocaleString()}` : '-'}</td>
                        <td className="px-4 py-3">{r.quantity || 0}</td>
                      </>
                    )}
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <button className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => setEditItem(r)}>
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button className="rounded-lg p-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10" onClick={() => removeMut.mutate(r._id)}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {showAdd && <AddRegisterModal category={filters.category} signageLocations={signageLocations} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); qc.invalidateQueries({ queryKey: ['branding-register'] }); }} />}
      {editItem && <EditRegisterModal item={editItem} signageLocations={signageLocations} onClose={() => setEditItem(null)} onSaved={() => { setEditItem(null); qc.invalidateQueries({ queryKey: ['branding-register'] }); }} />}
    </div>
  );
}

function AddRegisterModal({ category, signageLocations, onClose, onSaved }) {
  const [form, setForm] = useState({
    category,
    title: '',
    size: '',
    quantity: 1,
    location: '',
    signageLocation: '',
    organizationName: '',
    serialCodes: '',
    assignedTo: '',
    deviceType: '',
    specs: '',
    renewalDate: '',
    annualCost: '',
    notes: '',
  });
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) {
      toast.error('Title is required');
      return;
    }

    setLoading(true);
    try {
      await brandingRegisterApi.create(form);
      toast.success('Register item added');
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Save failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Add Register Item" size="lg">
      <form onSubmit={submit} className="space-y-4">
        <Select label="Category" value={form.category} onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}>
          {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </Select>

        <Input label={form.category === 'EQUIPMENT' ? 'Item / Licence name' : 'Title'} value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} required />

        {form.category !== 'EQUIPMENT' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Size" value={form.size} onChange={(e) => setForm((prev) => ({ ...prev, size: e.target.value }))} />
            <Input label="Quantity" type="number" min="0" value={form.quantity} onChange={(e) => setForm((prev) => ({ ...prev, quantity: e.target.value }))} />
            <Select label="Mapped signage (optional)" value={form.signageLocation} onChange={(e) => setForm((prev) => ({ ...prev, signageLocation: e.target.value }))} className="sm:col-span-2">
              <option value="">— Not mapped —</option>
              {signageLocations.map((loc) => <option key={loc._id} value={loc._id}>{loc.code} - {loc.place}</option>)}
            </Select>
          </div>
        )}

        {form.category === 'BANNER_BOARD' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Board place" value={form.location} onChange={(e) => setForm((prev) => ({ ...prev, location: e.target.value }))} />
            <Input label="College" value={form.organizationName} onChange={(e) => setForm((prev) => ({ ...prev, organizationName: e.target.value }))} />
            <Input label="Board serial numbers" value={form.serialCodes} onChange={(e) => setForm((prev) => ({ ...prev, serialCodes: e.target.value }))} className="sm:col-span-2" />
          </div>
        )}

        {form.category === 'EQUIPMENT' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Assigned to" value={form.assignedTo} onChange={(e) => setForm((prev) => ({ ...prev, assignedTo: e.target.value }))} />
            <Input label="Type" placeholder="Desktop / Laptop / Peripheral / Software Licence" value={form.deviceType} onChange={(e) => setForm((prev) => ({ ...prev, deviceType: e.target.value }))} />
            <Input label="Quantity" type="number" min="0" value={form.quantity} onChange={(e) => setForm((prev) => ({ ...prev, quantity: e.target.value }))} />
            <Input label="Renewal date" type="date" value={form.renewalDate} onChange={(e) => setForm((prev) => ({ ...prev, renewalDate: e.target.value }))} />
            <Input label="Annual cost (INR)" type="number" min="0" value={form.annualCost} onChange={(e) => setForm((prev) => ({ ...prev, annualCost: e.target.value }))} />
            <Input label="Specs" value={form.specs} onChange={(e) => setForm((prev) => ({ ...prev, specs: e.target.value }))} className="sm:col-span-2" />
          </div>
        )}

        <textarea className="input-base min-h-[90px]" placeholder="Notes" value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={loading}>Add Item</Button>
        </div>
      </form>
    </Modal>
  );
}

function EditRegisterModal({ item, signageLocations, onClose, onSaved }) {
  const [form, setForm] = useState({
    category: item.category || 'FRAME',
    title: item.title || '',
    size: item.size || '',
    quantity: item.quantity ?? 1,
    location: item.location || '',
    signageLocation: item.signageLocation?._id || item.signageLocation || '',
    organizationName: item.organizationName || '',
    serialCodes: item.serialCodes || '',
    assignedTo: item.assignedTo || '',
    deviceType: item.deviceType || '',
    specs: item.specs || '',
    renewalDate: item.renewalDate ? new Date(item.renewalDate).toISOString().slice(0, 10) : '',
    annualCost: item.annualCost ?? '',
    notes: item.notes || '',
  });
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) {
      toast.error('Title is required');
      return;
    }

    setLoading(true);
    try {
      await brandingRegisterApi.update(item._id, form);
      toast.success('Register item updated');
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Update failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Edit Register Item" size="lg">
      <form onSubmit={submit} className="space-y-4">
        <Select label="Category" value={form.category} onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}>
          {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </Select>

        <Input label={form.category === 'EQUIPMENT' ? 'Item / Licence name' : 'Title'} value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} required />

        {form.category !== 'EQUIPMENT' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Size" value={form.size} onChange={(e) => setForm((prev) => ({ ...prev, size: e.target.value }))} />
            <Input label="Quantity" type="number" min="0" value={form.quantity} onChange={(e) => setForm((prev) => ({ ...prev, quantity: e.target.value }))} />
            <Select label="Mapped signage (optional)" value={form.signageLocation} onChange={(e) => setForm((prev) => ({ ...prev, signageLocation: e.target.value }))} className="sm:col-span-2">
              <option value="">— Not mapped —</option>
              {signageLocations.map((loc) => <option key={loc._id} value={loc._id}>{loc.code} - {loc.place}</option>)}
            </Select>
          </div>
        )}

        {form.category === 'BANNER_BOARD' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Board place" value={form.location} onChange={(e) => setForm((prev) => ({ ...prev, location: e.target.value }))} />
            <Input label="College" value={form.organizationName} onChange={(e) => setForm((prev) => ({ ...prev, organizationName: e.target.value }))} />
            <Input label="Board serial numbers" value={form.serialCodes} onChange={(e) => setForm((prev) => ({ ...prev, serialCodes: e.target.value }))} className="sm:col-span-2" />
          </div>
        )}

        {form.category === 'EQUIPMENT' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Assigned to" value={form.assignedTo} onChange={(e) => setForm((prev) => ({ ...prev, assignedTo: e.target.value }))} />
            <Input label="Type" placeholder="Desktop / Laptop / Peripheral / Software Licence" value={form.deviceType} onChange={(e) => setForm((prev) => ({ ...prev, deviceType: e.target.value }))} />
            <Input label="Quantity" type="number" min="0" value={form.quantity} onChange={(e) => setForm((prev) => ({ ...prev, quantity: e.target.value }))} />
            <Input label="Renewal date" type="date" value={form.renewalDate} onChange={(e) => setForm((prev) => ({ ...prev, renewalDate: e.target.value }))} />
            <Input label="Annual cost (INR)" type="number" min="0" value={form.annualCost} onChange={(e) => setForm((prev) => ({ ...prev, annualCost: e.target.value }))} />
            <Input label="Specs" value={form.specs} onChange={(e) => setForm((prev) => ({ ...prev, specs: e.target.value }))} className="sm:col-span-2" />
          </div>
        )}

        <textarea className="input-base min-h-[90px]" placeholder="Notes" value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={loading}>Save changes</Button>
        </div>
      </form>
    </Modal>
  );
}
