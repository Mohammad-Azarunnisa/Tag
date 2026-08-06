import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { FileImage, Images, UploadCloud } from 'lucide-react';
import { dashboardApi } from '../../api/endpoints.js';
import { Card, Badge, EmptyState, Skeleton } from '../ui/primitives.jsx';
import { formatDate } from '../../lib/utils.js';

export default function MyUploads() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['dashboard', 'my-uploads'], queryFn: dashboardApi.myUploads });
  const uploads = data?.uploads || [];

  return (
    <Card className="p-5">
      <h3 className="mb-4 font-bold text-slate-800 dark:text-white">My Recent Uploads</h3>
      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : uploads.length === 0 ? (
        <EmptyState icon={UploadCloud} title="No uploads yet" description="Templates and assets you upload will appear here." />
      ) : (
        <div className="space-y-1">
          {uploads.map((u) => {
            const Icon = u.kind === 'Template' ? FileImage : Images;
            return (
              <button key={`${u.kind}-${u._id}`} onClick={() => navigate(u.kind === 'Template' ? '/templates' : '/assets')}
                className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50">
                {u.preview ? (
                  <img src={u.preview} alt="" className="h-10 w-10 rounded-lg object-cover" />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800"><Icon className="h-4 w-4 text-slate-400" /></div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{u.name}</p>
                  <p className="text-[11px] text-slate-400">{u.category} · {formatDate(u.createdAt)}</p>
                </div>
                <Badge>{u.kind}</Badge>
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}
