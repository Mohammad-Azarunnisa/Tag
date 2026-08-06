import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { cn } from '../../lib/utils.js';
import CountUp from './CountUp.jsx';

// Pass `to` to make the card clickable — it navigates to that route.
export default function StatCard({ label, value, icon: Icon, tone = 'brand', delay = 0, suffix, to }) {
  const navigate = useNavigate();
  // One consistent accent for every card — calmer, more premium than per-stat colours.
  const iconColor = 'text-brand-600';
  const iconBg = 'bg-brand-50';
  const iconBgDark = 'dark:bg-brand-500/10';
  const clickable = !!to;
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}
      onClick={clickable ? () => navigate(to) : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(to); } } : undefined}
      className={cn('card p-5', clickable && 'cursor-pointer transition hover:-translate-y-0.5 hover:shadow-glow focus:outline-none focus:ring-2 focus:ring-brand-500/40')}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-slate-400">{label}</p>
          <p className="mt-2 text-3xl font-extrabold tabular-nums tracking-tight text-slate-800 dark:text-white">
            {typeof value === 'number' ? <CountUp value={value} /> : value}{suffix}
          </p>
        </div>
        {Icon && (
          <div className={cn('rounded-xl p-2.5', iconBg, iconBgDark)}>
            <Icon className={cn('h-5 w-5', iconColor)} />
          </div>
        )}
      </div>
    </motion.div>
  );
}
