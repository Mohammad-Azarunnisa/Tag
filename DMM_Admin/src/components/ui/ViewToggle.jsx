import { useState } from 'react';
import { LayoutGrid, List } from 'lucide-react';
import { cn } from '../../lib/utils.js';

/**
 * Grid/list switch shared by the card-based pages (Brand Library, Events,
 * Signage, Post Planner) — the same control RepositoryPage uses for
 * Templates/Assets.
 *
 * The choice is remembered per page so a long list stays how you left it.
 */
export function useViewMode(storageKey, fallback = 'grid') {
  const [view, setViewState] = useState(() => localStorage.getItem(`view:${storageKey}`) || fallback);
  const setView = (v) => { setViewState(v); localStorage.setItem(`view:${storageKey}`, v); };
  return [view, setView];
}

export default function ViewToggle({ view, onChange, className }) {
  const btn = (active) =>
    cn('rounded-lg px-2.5 py-2', active
      ? 'bg-white text-brand-700 shadow-soft dark:bg-slate-900 dark:text-brand-300'
      : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300');

  return (
    <div className={cn('inline-flex shrink-0 self-start rounded-xl bg-slate-100 p-1 dark:bg-slate-800', className)}>
      <button type="button" onClick={() => onChange('grid')} title="Grid view" aria-label="Grid view"
        aria-pressed={view === 'grid'} className={btn(view === 'grid')}>
        <LayoutGrid className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => onChange('list')} title="List view" aria-label="List view"
        aria-pressed={view === 'list'} className={btn(view === 'list')}>
        <List className="h-4 w-4" />
      </button>
    </div>
  );
}
