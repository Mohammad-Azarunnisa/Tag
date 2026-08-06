import { useState } from 'react';
import { Info, Eye, EyeOff } from 'lucide-react';
import { cn, initials, STATUS_STYLES } from '../../lib/utils.js';

// ---- Card ----
export function Card({ className, children, ...props }) {
  return <div className={cn('card', className)} {...props}>{children}</div>;
}
export function CardBody({ className, children }) {
  return <div className={cn('p-5', className)}>{children}</div>;
}

// ---- Input ----
// Password inputs automatically get a show/hide toggle.
export function Input({ className, label, labelClassName, error, type, ...props }) {
  const [show, setShow] = useState(false);
  const isPassword = type === 'password';
  const ToggleIcon = show ? EyeOff : Eye;
  return (
    <label className="block">
      {label && <span className={cn('mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300', labelClassName)}>{label}</span>}
      <span className="relative block">
        <input
          type={isPassword && show ? 'text' : type}
          className={cn('input-base', isPassword && 'pr-10', error && 'border-rose-400 focus:border-rose-400 focus:ring-rose-500/10', className)}
          {...props}
        />
        {isPassword && (
          <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}
            className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            <ToggleIcon className="h-4 w-4" />
          </button>
        )}
      </span>
      {error && <span className="mt-1 block text-xs text-rose-500">{error}</span>}
    </label>
  );
}

// ---- Textarea ----
export function Textarea({ className, label, ...props }) {
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">{label}</span>}
      <textarea className={cn('input-base min-h-[96px] resize-y', className)} {...props} />
    </label>
  );
}

// ---- Select ----
export function Select({ className, label, children, ...props }) {
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">{label}</span>}
      <select className={cn('input-base cursor-pointer', className)} {...props}>{children}</select>
    </label>
  );
}

// ---- Badge ----
export function Badge({ children, className, status }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
      status ? STATUS_STYLES[status] : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300', className)}>
      {children}
    </span>
  );
}

// ---- Avatar ----
export function Avatar({ src, name = '', size = 'md', className }) {
  const sizes = { sm: 'h-8 w-8 text-xs', md: 'h-10 w-10 text-sm', lg: 'h-14 w-14 text-base' };
  return src ? (
    <img src={src} alt={name} className={cn('rounded-full object-cover ring-2 ring-white dark:ring-slate-800', sizes[size], className)} />
  ) : (
    <div className={cn('flex items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-700 dark:bg-brand-900 dark:text-brand-200', sizes[size], className)}>
      {initials(name)}
    </div>
  );
}

// ---- Skeleton ----
export function Skeleton({ className }) {
  return <div className={cn('animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800', className)} />;
}

// ---- InfoTip ----
// Small info icon that reveals a plain-language explanation on hover or
// keyboard focus. Pure Tailwind (named group + focus-within) — no positioning
// JS — so it can sit inside clickable cards without extra wiring.
export function InfoTip({ text, className }) {
  if (!text) return null;
  return (
    <span tabIndex={0} role="button" aria-label={text}
      className={cn('group/tip relative inline-flex shrink-0 cursor-help text-slate-300 outline-none hover:text-slate-400 focus:text-slate-400 dark:text-slate-600 dark:hover:text-slate-400 dark:focus:text-slate-400', className)}>
      <Info className="h-3.5 w-3.5" />
      <span className="pointer-events-none invisible absolute bottom-full left-1/2 z-50 mb-1.5 w-max max-w-[230px] -translate-x-1/2 whitespace-normal rounded-lg bg-slate-800 px-2.5 py-1.5 text-left text-[11px] font-normal normal-case leading-snug tracking-normal text-slate-100 opacity-0 shadow-lg transition-opacity group-hover/tip:visible group-hover/tip:opacity-100 group-focus-within/tip:visible group-focus-within/tip:opacity-100 dark:bg-slate-700">
        {text}
      </span>
    </span>
  );
}

// ---- EmptyState ----
export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 py-16 text-center">
      {Icon && <div className="mb-4 rounded-2xl bg-slate-100 dark:bg-slate-800 p-4"><Icon className="h-7 w-7 text-slate-400" /></div>}
      <h3 className="text-base font-semibold text-slate-700 dark:text-slate-200">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-400">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
