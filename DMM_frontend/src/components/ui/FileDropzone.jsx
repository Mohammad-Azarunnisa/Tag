import { useRef, useState } from 'react';
import { UploadCloud, X, GripVertical, Film, FileText } from 'lucide-react';
import { cn, formatBytes } from '../../lib/utils.js';

// Reusable drag & drop file input. `multiple` toggles single vs many files.
// When `reorderable` is set, the preview list can be drag-reordered — the array
// order IS the final order sent to the server.
export default function FileDropzone({ multiple = false, accept, files, onChange, reorderable = false, label = 'Drop files here or click to browse' }) {
  const inputRef = useRef(null);
  const [drag, setDrag] = useState(false);
  const [dragIdx, setDragIdx] = useState(null);

  const handleFiles = (list) => {
    const arr = Array.from(list);
    onChange(multiple ? [...(files || []), ...arr] : arr.slice(0, 1));
  };

  const removeAt = (i) => onChange(files.filter((_, idx) => idx !== i));
  const clearAll = () => onChange([]);

  // Reorder helpers (native HTML5 DnD)
  const onItemDrop = (targetIdx) => {
    if (dragIdx === null || dragIdx === targetIdx) return;
    const next = [...files];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(targetIdx, 0, moved);
    onChange(next);
    setDragIdx(null);
  };

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 text-center transition',
          drag ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10' : 'border-slate-200 dark:border-slate-700 hover:border-brand-400'
        )}
      >
        <UploadCloud className="mb-2 h-8 w-8 text-slate-400" />
        <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{label}</p>
        <p className="mt-1 text-xs text-slate-400">{multiple ? 'Images, videos, PDF, Office & Excel' : 'Single file'}{reorderable && files?.length > 1 ? ' · drag to reorder' : ''}</p>
        <input ref={inputRef} type="file" multiple={multiple} accept={accept} className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            // Let users pick the same file again after removing it.
            e.target.value = '';
          }} />
      </div>

      {files?.length > 0 && (
        <div className="mt-3 space-y-2">
          {multiple && files.length > 1 && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={clearAll}
                className="rounded px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-200 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                Clear all
              </button>
            </div>
          )}
          {files.map((f, i) => (
            <div
              key={i}
              draggable={reorderable}
              onDragStart={() => reorderable && setDragIdx(i)}
              onDragOver={(e) => reorderable && e.preventDefault()}
              onDrop={() => reorderable && onItemDrop(i)}
              className={cn(
                'flex items-center justify-between rounded-lg bg-slate-50 dark:bg-slate-800 px-3 py-2 transition',
                reorderable && 'cursor-grab active:cursor-grabbing',
                dragIdx === i && 'opacity-40 ring-2 ring-brand-400'
              )}
            >
              <div className="flex min-w-0 items-center gap-2">
                {reorderable && multiple && <GripVertical className="h-4 w-4 shrink-0 text-slate-400" />}
                {reorderable && <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-100 dark:bg-brand-500/20 text-[10px] font-bold text-brand-600">{i + 1}</span>}
                {f.type?.startsWith('image/') && (
                  <img src={URL.createObjectURL(f)} alt="" className="h-8 w-8 rounded object-cover" />
                )}
                {f.type?.startsWith('video/') && (
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-slate-200 dark:bg-slate-700">
                    <Film className="h-4 w-4 text-slate-500" />
                  </span>
                )}
                {/* Documents (PDF / Office / Excel / PSD …) can't be previewed */}
                {!f.type?.startsWith('image/') && !f.type?.startsWith('video/') && (
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-slate-200 dark:bg-slate-700">
                    <FileText className="h-4 w-4 text-slate-500" />
                  </span>
                )}
                <span className="truncate text-sm text-slate-600 dark:text-slate-300">{f.name}</span>
                <span className="shrink-0 text-xs text-slate-400">{formatBytes(f.size)}</span>
              </div>
              <button type="button" onClick={(e) => { e.stopPropagation(); removeAt(i); }} className="rounded p-1 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
