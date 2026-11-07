import { useEffect, useRef, useState } from 'react';
import { Download, FileText, Loader2 } from 'lucide-react';
import { isVideo } from '../lib/utils.js';

const extOf = (m) => {
  const n = String(m?.name || '').toLowerCase().split('?')[0];
  const fromName = n.includes('.') ? n.slice(n.lastIndexOf('.') + 1) : '';
  if (fromName) return fromName;
  const u = String(m?.url || '').toLowerCase().split('?')[0];
  return u.includes('.') ? u.slice(u.lastIndexOf('.') + 1) : '';
};

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg']);
const TEXT = new Set(['txt', 'csv']);

// A PSD is not something a browser can draw, so it is read here and its flattened
// composite is painted to a canvas — the design as it was saved, not a stand-in.
function PsdPreview({ item }) {
  const canvasRef = useRef(null);
  const [state, setState] = useState('loading');
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const [{ readPsd }, buf] = await Promise.all([
          import('ag-psd'),
          fetch(item.url).then((r) => { if (!r.ok) throw new Error('fetch'); return r.arrayBuffer(); }),
        ]);
        const psd = readPsd(buf, { skipLayerImageData: true, skipThumbnail: true });
        if (dead) return;
        if (!psd.canvas) throw new Error('no composite');
        const c = canvasRef.current;
        c.width = psd.canvas.width; c.height = psd.canvas.height;
        c.getContext('2d').drawImage(psd.canvas, 0, 0);
        setState('ready');
      } catch { if (!dead) setState('failed'); }
    })();
    return () => { dead = true; };
  }, [item.url]);

  if (state === 'failed') return <NoPreview item={item} why="This Photoshop file has no flattened preview saved inside it (it was saved without “Maximize compatibility”)." />;
  return (
    <div className="flex min-h-[200px] items-center justify-center rounded-xl bg-[repeating-conic-gradient(#e2e8f0_0%_25%,#f8fafc_0%_50%)] bg-[length:16px_16px]">
      {state === 'loading' && <Loader2 className="h-6 w-6 animate-spin text-slate-400" />}
      <canvas ref={canvasRef} className={state === 'ready' ? 'max-h-[70vh] max-w-full object-contain' : 'hidden'} />
    </div>
  );
}

function TextPreview({ item }) {
  const [text, setText] = useState(null);
  useEffect(() => { fetch(item.url).then((r) => r.text()).then((t) => setText(t.slice(0, 20000))).catch(() => setText(false)); }, [item.url]);
  if (text === false) return <NoPreview item={item} />;
  return <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-xs dark:bg-slate-800">{text ?? 'Loading…'}</pre>;
}

function NoPreview({ item, why }) {
  const ext = extOf(item).toUpperCase();
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 p-6 text-center dark:border-slate-700">
      <FileText className="h-10 w-10 text-slate-400" />
      <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{item.name || 'File'}</p>
      <p className="max-w-sm text-xs text-slate-500">{why || `A browser cannot display ${ext ? `.${ext}` : 'this kind of'} files. Download it and open it in its own app to inspect the design.`}</p>
      <a href={item.url} download target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:underline dark:text-brand-400">
        <Download className="h-4 w-4" /> Download the file
      </a>
    </div>
  );
}

// The actual uploaded file, shown as large as it will go, whatever it is.
export default function FilePreview({ item }) {
  const ext = extOf(item);
  if (isVideo(item)) return <video src={item.url} controls className="max-h-[70vh] w-full rounded-xl" />;
  if (item.mediaType === 'image' || IMAGE.has(ext)) return <img src={item.url} alt={item.name || ''} className="max-h-[70vh] w-full rounded-xl object-contain" />;
  if (ext === 'pdf') return <iframe src={item.url} title={item.name || 'PDF'} className="h-[70vh] w-full rounded-xl border border-slate-200 dark:border-slate-700" />;
  if (ext === 'psd') return <PsdPreview item={item} />;
  if (TEXT.has(ext)) return <TextPreview item={item} />;
  return <NoPreview item={item} />;
}

export const previewKind = (m) => {
  const ext = extOf(m);
  if (isVideo(m)) return 'video';
  if (m?.mediaType === 'image' || IMAGE.has(ext)) return 'image';
  return ext || 'file';
};
