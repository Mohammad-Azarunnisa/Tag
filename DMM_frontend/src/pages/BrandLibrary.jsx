import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Images, ExternalLink, Download, FileText, Link as LinkIcon, Play, Globe, Film, Search } from 'lucide-react';
import { libraryApi, linkApi, organizationApi } from '../api/endpoints.js';
import { useAuthStore } from '../store/authStore.js';
import { youtubeThumb, cn, isCoordinatorUser } from '../lib/utils.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import { Card, Input, Select, Skeleton, EmptyState } from '../components/ui/primitives.jsx';
import ViewToggle, { useViewMode } from '../components/ui/ViewToggle.jsx';

const CATEGORIES = ['Flyer', 'Brochure', 'Branding Video', 'Image', 'Document', 'Other'];

const TYPE_META = {
  Video: { tone: 'from-red-500/20 to-rose-500/5 text-red-500', icon: Film },
  PDF: { tone: 'from-rose-500/20 to-orange-500/5 text-rose-500', icon: FileText },
  Document: { tone: 'from-indigo-500/20 to-blue-500/5 text-indigo-500', icon: FileText },
  Link: { tone: 'from-brand-500/20 to-amber-500/5 text-brand-500', icon: Globe },
  Image: { tone: 'from-emerald-500/20 to-teal-500/5 text-emerald-500', icon: Images },
};
const itemType = (item) => {
  if (item.mediaType === 'image') return 'Image';
  if (item.mediaType === 'video') return 'Video';
  if (item.kind === 'link') return 'Link';
  return (item.url || '').toLowerCase().endsWith('.pdf') ? 'PDF' : 'Document';
};

function Placeholder({ type, label }) {
  const meta = TYPE_META[type] || TYPE_META.Document;
  const Icon = meta.icon;
  return (
    <div className={cn('flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br px-4 text-center', meta.tone)}>
      <Icon className="h-10 w-10" />
      {label && <span className="max-w-full truncate text-xs font-semibold opacity-80">{label}</span>}
    </div>
  );
}

// Which college an item belongs to — same chip the Template/Asset repositories use.
function OrgChip({ organization }) {
  if (!organization) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-slate-900/70 px-2 py-0.5 text-[11px] font-semibold text-white">
        <Globe className="h-3 w-3" /> Shared
      </span>
    );
  }
  return (
    <span className="inline-flex max-w-[160px] items-center gap-1.5 rounded-md bg-slate-900/70 px-2 py-0.5 text-[11px] font-semibold text-white">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: organization.color || '#f15d27' }} />
      <span className="truncate">{organization.name}</span>
    </span>
  );
}

function LinkThumb({ url }) {
  const { data, isLoading } = useQuery({ queryKey: ['link-preview', url], queryFn: () => linkApi.preview(url), staleTime: Infinity, retry: false });
  if (data?.image) {
    return (
      <>
        <img src={data.image} alt="" className="h-full w-full object-cover" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
        <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-md bg-slate-900/70 px-1.5 py-0.5 text-[10px] font-semibold text-white"><ExternalLink className="h-3 w-3" />{data.siteName}</span>
      </>
    );
  }
  return <Placeholder type="Link" label={isLoading ? 'Loading preview…' : (data?.siteName || 'External link')} />;
}

function BrandCard({ item }) {
  const ytThumb = item.kind === 'link' ? youtubeThumb(item.url) : null;
  const isLink = item.kind === 'link';
  const type = ytThumb ? 'Video' : itemType(item);
  return (
    <Card className="group overflow-hidden">
      <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-slate-100 dark:bg-slate-800">
        {item.mediaType === 'image' ? (
          <img src={item.url} alt={item.title} className="h-full w-full object-cover" />
        ) : ytThumb ? (
          <a href={item.url} target="_blank" rel="noreferrer" className="group/thumb block h-full w-full">
            <img src={ytThumb} alt={item.title} className="h-full w-full object-cover" />
            <span className="absolute inset-0 flex items-center justify-center bg-black/10 transition-colors group-hover/thumb:bg-black/25">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red-600 text-white shadow-lg"><Play className="h-6 w-6 translate-x-0.5 fill-white" /></span>
            </span>
          </a>
        ) : item.mediaType === 'video' ? (
          <video src={item.url} className="h-full w-full object-cover" muted />
        ) : isLink ? (
          <LinkThumb url={item.url} />
        ) : (
          <Placeholder type={type} label={type} />
        )}
        <span className="absolute left-2 top-2 rounded-md bg-slate-900/70 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur-sm">{item.category}</span>
        <span className="absolute right-2 top-2 rounded-md bg-white/85 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600 backdrop-blur-sm dark:bg-slate-900/80 dark:text-slate-300">{type}</span>
        <span className="absolute bottom-2 left-2"><OrgChip organization={item.organization} /></span>
      </div>
      <div className="p-4">
        <p className="truncate font-semibold text-slate-800 dark:text-white">{item.title}</p>
        {item.description && <p className="mt-1 line-clamp-2 text-xs text-slate-400">{item.description}</p>}
        <a href={item.url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300">
          {isLink ? <><ExternalLink className="h-3.5 w-3.5" /> Open link</> : <><Download className="h-3.5 w-3.5" /> View / download</>}
        </a>
      </div>
    </Card>
  );
}

// Compact thumbnail for list rows. Deliberately does NOT fetch Open-Graph
// previews the way LinkThumb does — one request per row would be wasteful, so a
// plain link shows its type icon instead.
function RowThumb({ item, type }) {
  const ytThumb = item.kind === 'link' ? youtubeThumb(item.url) : null;
  const src = item.mediaType === 'image' ? item.url : ytThumb;
  const Icon = (TYPE_META[type] || TYPE_META.Document).icon;
  return (
    <span className="flex h-10 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <Icon className="h-4 w-4 text-slate-400" />}
    </span>
  );
}

function BrandRow({ item }) {
  const isLink = item.kind === 'link';
  const ytThumb = isLink ? youtubeThumb(item.url) : null;
  const type = ytThumb ? 'Video' : itemType(item);
  return (
    <tr className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50">
      <td className="px-4 py-2.5">
        <a href={item.url} target="_blank" rel="noreferrer" className="flex items-center gap-3">
          <RowThumb item={item} type={type} />
          <span className="min-w-0">
            <span className="block truncate font-semibold text-slate-800 dark:text-white">{item.title}</span>
            {item.description && <span className="block max-w-[320px] truncate text-xs text-slate-400">{item.description}</span>}
          </span>
        </a>
      </td>
      <td className="px-3 py-2.5"><OrgChip organization={item.organization} /></td>
      <td className="px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400">{item.category}</td>
      <td className="px-3 py-2.5">
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">{type}</span>
      </td>
      <td className="px-3 py-2.5 text-right">
        <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300">
          {isLink ? <><ExternalLink className="h-3.5 w-3.5" /> Open</> : <><Download className="h-3.5 w-3.5" /> View</>}
        </a>
      </td>
    </tr>
  );
}

export default function BrandLibrary() {
  const user = useAuthStore((s) => s.user);
  // One college: nothing to filter by.
  const oneCollege = isCoordinatorUser(user);
  const [search, setSearch] = useState('');
  const [orgFilter, setOrgFilter] = useState(''); // '' = all, 'shared', or an org id
  const [category, setCategory] = useState('All');
  const [view, setView] = useViewMode('brand-library');

  const { data: orgData } = useQuery({
    queryKey: ['org-options'], queryFn: organizationApi.options, enabled: !oneCollege,
  });
  const orgs = orgData?.organizations || [];

  const { data, isLoading } = useQuery({
    queryKey: ['brand', { search, category, orgFilter }],
    queryFn: () => libraryApi.brand({ search, category, organizationId: orgFilter || undefined }),
  });
  const items = data?.items || [];
  const filtered = !!search.trim() || !!orgFilter || category !== 'All';

  return (
    <div>
      <PageHeader title="Brand Library" subtitle="Flyers, brochures, branding videos and marketing material for your organization — view, download or share." />

      {/* Filters + view toggle — same set as the Template / Asset repositories */}
      <div className="mb-5 flex flex-col gap-3 lg:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input placeholder="Search title or description…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {!oneCollege && (
          <Select className="lg:w-56" value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)} title="Filter by college">
            <option value="">All colleges</option>
            <option value="shared">Shared (all colleges) only</option>
            {orgs.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
          </Select>
        )}
        <Select className="lg:w-56" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="All">All Categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
        <ViewToggle view={view} onChange={setView} />
      </div>

      {isLoading ? (
        view === 'grid' ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-56" />)}</div>
        ) : (
          <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
        )
      ) : items.length === 0 ? (
        filtered ? (
          <EmptyState icon={Images} title="Nothing matches these filters" description="Try another college or category, or clear the search." />
        ) : (
          <EmptyState icon={Images} title="Nothing here yet" description="Your admin hasn't added brand material yet." />
        )
      ) : view === 'grid' ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => <BrandCard key={it._id} item={it} />)}
        </div>
      ) : (
        /* List view — compact rows for scanning a big library */
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs font-bold uppercase tracking-wide text-slate-400 dark:border-slate-800">
                <th className="px-4 py-3">Item</th>
                <th className="px-3 py-3">College</th>
                <th className="px-3 py-3">Category</th>
                <th className="px-3 py-3">Type</th>
                <th className="px-3 py-3 text-right">Open</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => <BrandRow key={it._id} item={it} />)}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
