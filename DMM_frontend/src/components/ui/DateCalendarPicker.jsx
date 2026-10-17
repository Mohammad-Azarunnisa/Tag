import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils.js';

const pad = (n) => String(n).padStart(2, '0');
const keyOf = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pretty = (key) => new Date(`${key}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });

/**
 * A small calendar for choosing one date, where some days can't be chosen.
 *
 * `blockedReason(key)` returns a short text for a day that can't be picked (for
 * example "Sunday", "Dussehra" or "Too soon for this request") and null for a day
 * that can. Hovering a blocked day shows that text in a bubble, which a plain
 * <input type="date"> cannot do.
 */
export default function DateCalendarPicker({ label, value, onChange, blockedReason, placeholder = 'Choose a date' }) {
  const today = new Date();
  const start = value ? new Date(`${value}T00:00:00`) : today;
  const [open, setOpen] = useState(false);
  const [view, setView] = useState({ y: start.getFullYear(), m: start.getMonth() });
  const [hover, setHover] = useState(null);
  const box = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  const cells = useMemo(() => {
    const first = new Date(view.y, view.m, 1).getDay();
    const days = new Date(view.y, view.m + 1, 0).getDate();
    return [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  }, [view]);

  const shift = (delta) => setView((v) => {
    const d = new Date(v.y, v.m + delta, 1);
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const todayKey = keyOf(today.getFullYear(), today.getMonth(), today.getDate());

  return (
    <div className="block" ref={box}>
      {label && <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">{label}</span>}
      <div className="relative">
        <button type="button" onClick={() => setOpen((o) => !o)}
          className={cn('input-base flex items-center justify-between text-left', !value && 'text-slate-400')}>
          <span>{value ? pretty(value) : placeholder}</span>
          <CalendarDays className="h-4 w-4 text-slate-400" />
        </button>

        {open && (
          <div className="absolute left-0 top-full z-30 mt-2 w-[19rem] rounded-2xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-2 flex items-center justify-between">
              <button type="button" onClick={() => shift(-1)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></button>
              <b className="text-sm text-slate-800 dark:text-slate-100">{MONTHS[view.m]} {view.y}</b>
              <button type="button" onClick={() => shift(1)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Next month"><ChevronRight className="h-4 w-4" /></button>
            </div>
            <div className="grid grid-cols-7 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              {WEEKDAYS.map((w) => <span key={w} className="py-1">{w}</span>)}
            </div>
            <div className="grid grid-cols-7 gap-y-1 text-center">
              {cells.map((d, i) => {
                if (!d) return <span key={`b${i}`} />;
                const key = keyOf(view.y, view.m, d);
                const reason = key < todayKey ? 'This date has passed' : blockedReason?.(key);
                const selected = key === value;
                return (
                  <span key={key} className="relative flex justify-center"
                    onMouseOver={() => setHover(key)} onMouseOut={() => setHover((h) => (h === key ? null : h))} onFocus={() => setHover(key)} onBlur={() => setHover(null)}>
                    <button type="button" aria-disabled={!!reason} title={reason || undefined}
                      onClick={() => { if (reason) return; onChange(key); setOpen(false); }}
                      className={cn(
                        'h-9 w-9 rounded-full text-sm transition-colors',
                        reason ? 'cursor-not-allowed text-slate-300 line-through decoration-slate-300 dark:text-slate-600'
                          : selected ? 'bg-brand-500 font-bold text-white' : 'text-slate-700 hover:bg-brand-50 dark:text-slate-200 dark:hover:bg-slate-800',
                        key === todayKey && !selected && !reason && 'ring-1 ring-brand-300',
                      )}>{d}</button>
                    {reason && hover === key && (
                      <span className="pointer-events-none absolute -top-9 left-1/2 z-40 -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white shadow-lg dark:bg-slate-100 dark:text-slate-900">
                        {reason}
                      </span>
                    )}
                  </span>
                );
              })}
            </div>
            <p className="mt-2 border-t border-slate-100 pt-2 text-[11px] text-slate-400 dark:border-slate-800">Crossed-out days can't be chosen — hover one to see why.</p>
          </div>
        )}
      </div>
    </div>
  );
}
