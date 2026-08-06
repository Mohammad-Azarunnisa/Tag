import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, CheckSquare, FileImage, Images, User, Loader2 } from 'lucide-react';
import { searchApi } from '../../api/endpoints.js';
import { Badge } from '../ui/primitives.jsx';
import { roleLabel } from '../../lib/utils.js';

// Debounced global search with a results dropdown. Searches approvals,
// templates, assets and (for CEO) users via /api/search.
export default function GlobalSearch() {
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(term), 300);
    return () => clearTimeout(t);
  }, [term]);

  useEffect(() => {
    const onClick = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const { data, isFetching } = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => searchApi.query(debounced),
    enabled: debounced.trim().length >= 2,
  });
  const results = data?.results || { approvals: [], templates: [], assets: [], users: [] };
  const total = results.approvals.length + results.templates.length + results.assets.length + results.users.length;

  const go = (path) => { setOpen(false); setTerm(''); navigate(path); };

  return (
    <div ref={boxRef} className="relative w-full max-w-md">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        value={term}
        onChange={(e) => { setTerm(e.target.value); setOpen(true); }}
        onFocus={() => term && setOpen(true)}
        placeholder="Search approvals, templates, assets..."
        className="input-base pl-9"
      />
      {isFetching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />}

      {open && debounced.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-12 z-30 max-h-[70vh] overflow-y-auto rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-2 shadow-card">
          {total === 0 && !isFetching && <p className="px-3 py-6 text-center text-sm text-slate-400">No results for “{debounced}”</p>}

          <Group label="Approvals" icon={CheckSquare} items={results.approvals}
            render={(r) => (
              <button key={r._id} onClick={() => go(`/approvals/${r._id}`)} className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800">
                <span className="truncate"><span className="font-medium text-slate-700 dark:text-slate-200">{r.title}</span> <span className="text-slate-400">· {r.platform}</span></span>
                <Badge status={r.status}>{r.status}</Badge>
              </button>
            )} />

          <Group label="Templates" icon={FileImage} items={results.templates}
            render={(t) => (
              <button key={t._id} onClick={() => go('/templates')} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800">
                {t.thumbnail && <img src={t.thumbnail} alt="" className="h-6 w-6 rounded object-cover" />}
                <span className="truncate font-medium text-slate-700 dark:text-slate-200">{t.name}</span>
                <span className="ml-auto text-xs text-slate-400">{t.category}</span>
              </button>
            )} />

          <Group label="Assets" icon={Images} items={results.assets}
            render={(a) => (
              <button key={a._id} onClick={() => go('/assets')} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800">
                {a.previewImage && <img src={a.previewImage} alt="" className="h-6 w-6 rounded object-cover" />}
                <span className="truncate font-medium text-slate-700 dark:text-slate-200">{a.name}</span>
                <span className="ml-auto text-xs text-slate-400">{a.category}</span>
              </button>
            )} />

          <Group label="Users" icon={User} items={results.users}
            render={(u) => (
              <div key={u._id} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm">
                <span className="font-medium text-slate-700 dark:text-slate-200">{u.name}</span>
                <span className="text-xs text-slate-400">{u.email}</span>
                <Badge className="ml-auto">{roleLabel(u)}</Badge>
              </div>
            )} />
        </div>
      )}
    </div>
  );
}

function Group({ label, icon: Icon, items, render }) {
  if (!items?.length) return null;
  return (
    <div className="mb-1">
      <div className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        <Icon className="h-3.5 w-3.5" /> {label} ({items.length})
      </div>
      {items.map(render)}
    </div>
  );
}
