import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils.js';

const PANEL_MAX_H = 288; // max-h-72
const GAP = 8; // breathing room between the button and the panel

// A themed replacement for a native <select> on the dark hero panels.
//
// The option list of a native select is drawn by the operating system, not by
// the page, so no amount of CSS can make it match the product — which is why
// the markup this replaces carried a `[&>option]:text-slate-800` hack just to
// keep the text legible against the OS's own white list.
//
// The panel is rendered through a portal with fixed positioning rather than as
// an absolutely-positioned child. The hero banners this sits in are
// `overflow-hidden` (for their rounded corners and blurred decorations) and
// `isolate`, which between them clip the list at the banner's edge and trap any
// z-index inside it — a normal dropdown loses every option past the fold. A
// portal escapes both, so the list is never cut off wherever this is used.
//
// options: [{ value, label }]
export default function OrgSelect({ value, onChange, options = [], ariaLabel = 'Select', className }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1); // keyboard-highlighted row
  const [pos, setPos] = useState(null); // fixed coords for the portalled panel
  const btnRef = useRef(null);
  const panelRef = useRef(null);
  const listRef = useRef(null);

  const selected = options.find((o) => String(o.value) === String(value));

  // Anchor the panel to the button in viewport coordinates, flipping above when
  // there isn't room below, and capping the height to the space available.
  const place = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - GAP;
    const above = r.top - GAP;
    const dropUp = below < Math.min(PANEL_MAX_H, 200) && above > below;
    // Right-aligned to the trigger (it sits at the right edge of the banners),
    // then clamped so a wider panel can never hang off either side.
    const width = Math.max(r.width, 200);
    const left = Math.max(GAP, Math.min(r.right - width, window.innerWidth - width - GAP));
    setPos({
      left,
      width,
      maxHeight: Math.max(120, Math.min(PANEL_MAX_H, dropUp ? above : below)),
      ...(dropUp
        ? { bottom: window.innerHeight - r.top + GAP, top: 'auto' }
        : { top: r.bottom + GAP, bottom: 'auto' }),
    });
  }, []);

  // Measure before paint so the panel never appears in the wrong spot first.
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  // Keep it anchored while the page moves under it. Scroll is captured so
  // scrolling any ancestor container counts, not just the window.
  useEffect(() => {
    if (!open) return undefined;
    const onMove = () => place();
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open, place]);

  // Close on any click outside, and on Escape. The panel lives in a portal, so
  // it is not a DOM descendant of the button — both have to be checked, or
  // choosing an option would close the list before the click landed on it.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      if (btnRef.current?.contains(e.target)) return;
      if (panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Opening lands the highlight on the current choice, so Enter without moving
  // is a no-op rather than a surprise.
  useEffect(() => {
    if (!open) return;
    setActive(options.findIndex((o) => String(o.value) === String(value)));
    // Keyed on `open` alone: `options` is rebuilt inline by the caller each
    // render, and re-running this would snap the highlight back mid-keyboard-nav.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keep the highlighted row in view when arrowing through a long list.
  useEffect(() => {
    if (!open || active < 0) return;
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const choose = (next) => {
    onChange(next);
    setOpen(false);
    btnRef.current?.focus();
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(options.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(options.length - 1); }
    else if (e.key === 'Tab') { setOpen(false); }
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (options[active]) choose(options[active].value);
    }
  };

  return (
    <div className={cn('relative', className)}>
      <button
        ref={btnRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKeyDown}
        className="flex h-10 w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-white/15 bg-white/10 px-3 text-sm font-semibold text-white outline-none backdrop-blur transition hover:bg-white/15 focus:ring-4 focus:ring-brand-500/30"
      >
        <span className="truncate">{selected?.label || 'Select'}</span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-white/70 transition-transform', open && 'rotate-180')} />
      </button>

      {open && pos && createPortal(
        <ul
          ref={(node) => { panelRef.current = node; listRef.current = node; }}
          role="listbox"
          aria-label={ariaLabel}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          style={{
            position: 'fixed',
            left: pos.left,
            top: pos.top,
            bottom: pos.bottom,
            width: pos.width,
            maxHeight: pos.maxHeight,
            zIndex: 60,
          }}
          className="overflow-y-auto rounded-xl border border-slate-100 bg-white p-1.5 text-left shadow-card dark:border-slate-800 dark:bg-slate-900"
        >
          {options.map((o, i) => {
            const isSelected = String(o.value) === String(value);
            return (
              <li key={o.value} role="option" aria-selected={isSelected}>
                <button
                  type="button"
                  onClick={() => choose(o.value)}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                    isSelected
                      ? 'font-semibold text-brand-600 dark:text-brand-400'
                      : 'text-slate-600 dark:text-slate-300',
                    i === active && 'bg-slate-100 dark:bg-slate-800'
                  )}
                >
                  <span className="truncate">{o.label}</span>
                  {isSelected && <Check className="h-4 w-4 shrink-0" />}
                </button>
              </li>
            );
          })}
        </ul>,
        document.body
      )}
    </div>
  );
}
