import { useEffect, useMemo, useRef, useState } from 'react';
import { UploadCloud, X, GripVertical, Film, FileText } from 'lucide-react';
import { cn, formatBytes } from '../../lib/utils.js';

// 500MB — matches the backend's upload cap (see DMM_backend/src/middleware/upload.js).
const MAX_FILE_BYTES = 500 * 1024 * 1024;

// Does this file satisfy an <input accept="..."> style pattern list? Native
// pickers enforce `accept` on their own, but a drag-and-drop never goes through
// the picker, so it needs the same check applied by hand.
const matchesAccept = (file, accept) => {
  if (!accept) return true;
  const patterns = accept.split(',').map((p) => p.trim()).filter(Boolean);
  if (!patterns.length) return true;
  return patterns.some((pattern) => {
    if (pattern.startsWith('.')) return file.name.toLowerCase().endsWith(pattern.toLowerCase());
    if (pattern.endsWith('/*')) return (file.type || '').startsWith(pattern.slice(0, -1));
    return file.type === pattern;
  });
};

// Reusable drag & drop file input. `multiple` toggles single vs many files.
// When `reorderable` is set, the preview list can be drag-reordered — the array
// order IS the final order sent to the server.
export default function FileDropzone({ multiple = false, accept, files, onChange, reorderable = false, label = 'Drop files here or click to browse' }) {
  const inputRef = useRef(null);
  const [drag, setDrag] = useState(false);
  const [dragIdx, setDragIdx] = useState(null);
  const [error, setError] = useState('');

  // One object URL per image file, kept stable across re-renders and revoked
  // the moment a file drops out of the list (or the component unmounts) so
  // previews don't leak blob URLs forever.
  const previewUrlsRef = useRef(new Map());
  const previewUrls = useMemo(() => {
    const next = new Map();
    (files || []).forEach((f) => {
      if (f.type?.startsWith('image/')) {
        next.set(f, previewUrlsRef.current.get(f) || URL.createObjectURL(f));
      }
    });
    previewUrlsRef.current.forEach((url, f) => { if (!next.has(f)) URL.revokeObjectURL(url); });
    previewUrlsRef.current = next;
    return next;
  }, [files]);

  useEffect(() => () => { previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url)); }, []);

  const handleFiles = (list) => {
    const arr = Array.from(list);
    if (!arr.length) return;
    const tooBig = arr.filter((f) => f.size > MAX_FILE_BYTES);
    if (tooBig.length) {
      setError(`${tooBig.length === 1 ? 'This file is' : 'These files are'} over the 500MB limit: ${tooBig.map((f) => f.name).join(', ')}`);
      return;
    }
    const wrongType = arr.filter((f) => !matchesAccept(f, accept));
    if (wrongType.length) {
      setError(`${wrongType.length === 1 ? 'This file type isn' : "These file types aren"}'t supported: ${wrongType.map((f) => f.name).join(', ')}`);
      return;
    }
    setError('');
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

      {error && <p className="mt-2 text-xs font-semibold text-rose-600 dark:text-rose-400">{error}</p>}

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
              key={`${f.name}-${f.size}-${f.lastModified}`}
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
                  <img src={previewUrls.get(f)} alt="" className="h-8 w-8 rounded object-cover" />
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
